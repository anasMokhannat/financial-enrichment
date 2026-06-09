/**
 * PDF-backed financial extractor.
 *
 * Pipeline per filing:
 *   1. NBBClient.downloadPdf() → raw PDF bytes (or null → return null).
 *   2. pdf-parse → full text dump of the PDF.
 *   3. Trim to a safe token budget (heuristic: ~4 chars / token).
 *   4. OpenAI Chat Completions with `response_format: json_schema`,
 *      strict=true. The schema mirrors the 14 numeric fields of
 *      FinancialStatement, so the response parses straight into a
 *      domain object without manual coercion of model output.
 *
 * Why this design
 * ---------------
 * Belgian NBB filings are well-structured PDFs (text-layer, not scans)
 * with consistent heading codes (70, 9901, 20/58, …). pdf-parse returns
 * the text in document order with reasonable line breaks; modern LLMs
 * read that tabular text accurately. The Python reference impl used the
 * same approach with pdfplumber + OpenAI structured outputs, so we're
 * porting a known-good shape.
 *
 * Cost: roughly $0.005-$0.02 per filing on gpt-4o-mini after trimming,
 * depending on filing length.
 */

import OpenAI from "openai";
// Direct lib path: pdf-parse's index.js eagerly reads a debug test PDF
// at module-load time, which crashes Next.js during build (no test
// fixture in production). Importing the lib file skips that block.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

import { DocumentRepository } from "../db/repository";
import { FinancialExtractionError } from "../errors";
import { createLlmClient, type LlmClient } from "../llm";
import { createLogger } from "../log";
import {
  fiscalYear,
  FilingReference,
  FinancialStatement,
} from "../models";
import type { NBBClient } from "../nbb/client";

const log = createLogger("extraction:pdf");

/**
 * Maximum PDF text length sent to the model. ~4 chars/token puts this
 * at ~30K tokens which leaves comfortable headroom on a 128K-context
 * model after the system prompt + completion budget.
 */
const MAX_TEXT_CHARS = 120_000;

/**
 * Heading anchors used to find the financial-statement section in the
 * full PDF text. Belgian filings follow a fixed structure: section
 * "VOL-kap 3" / "VKT-kap 3" is the balance sheet, "4" is the income
 * statement, "6.10" is the social balance (FTE). We slice the text
 * starting from the first anchor; if none match, we send the head of
 * the document up to MAX_TEXT_CHARS.
 */
const SECTION_ANCHORS = [
  /\b(?:VOL|VKT|MIC)-kap\s*3\b/i,
  /\bN°\s*3\.1\b/, // Belgian filings number the balance sheet "N° 3.1"
  /\bBALANS\b/i,
  /\bBILAN\b/i,
  /\bBalance sheet\b/i,
];

const SYSTEM_PROMPT = `You extract structured financial data from Belgian
annual-accounts PDFs (NBB deposit format) and return it as JSON matching
the provided schema.

Source layout
- The text is the raw extraction of a Belgian annual filing.
- Numeric values are in EUR. The Belgian decimal convention is comma
  ("1.234,56" = 1234.56). Thousand separators are dots or spaces.
- Every reported line item carries a NBB heading code (e.g. "70" for
  turnover, "9901" for operating profit, "9904" for net profit,
  "20/58" for total assets, "10/15" for equity, "17" for long-term
  debt, "42/48" for short-term debt, "54/58" for cash, "3" for
  inventory, "630" for depreciation, "9087" for average FTE).
- Filings show two columns: current year and previous year. Always
  return the CURRENT-year value, which is the LEFT column.

Heading-code → field mapping
  revenue              ← 70
  operating_profit     ← 9901
  net_profit           ← 9904
  total_assets         ← 20/58
  fixed_assets         ← 20/28  (or 21/28 on some schemas)
  current_assets       ← 29/58
  total_equity         ← 10/15
  total_liabilities    ← 17/49 (sum of 17 + 16 if 17/49 absent)
  long_term_debt       ← 17
  short_term_debt      ← 42/48
  cash_and_equivalents ← 54/58
  inventory            ← 3   (or 30/36)
  depreciation         ← 630
  employees_fte        ← 9087

Rules
- Return numbers as plain JSON numbers (not strings, not formatted).
  Examples: 1234567, 0.5, -12000.
- If a field is not present in the text, return null. NEVER guess and
  NEVER zero — null means "not reported".
- Distinguish current vs previous: many filings render both years on
  the same row. Read the LEFT (current) column unless the text clearly
  inverts that order.
- Output strictly the JSON object the schema specifies. No prose.`;

/** Strict JSON schema for the structured-output response. */
const RESPONSE_SCHEMA = {
  name: "FinancialStatementValues",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "revenue",
      "operating_profit",
      "net_profit",
      "total_assets",
      "fixed_assets",
      "current_assets",
      "total_equity",
      "total_liabilities",
      "long_term_debt",
      "short_term_debt",
      "cash_and_equivalents",
      "inventory",
      "depreciation",
      "employees_fte",
    ],
    properties: {
      revenue: nullableNumber(),
      operating_profit: nullableNumber(),
      net_profit: nullableNumber(),
      total_assets: nullableNumber(),
      fixed_assets: nullableNumber(),
      current_assets: nullableNumber(),
      total_equity: nullableNumber(),
      total_liabilities: nullableNumber(),
      long_term_debt: nullableNumber(),
      short_term_debt: nullableNumber(),
      cash_and_equivalents: nullableNumber(),
      inventory: nullableNumber(),
      depreciation: nullableNumber(),
      employees_fte: nullableNumber(),
    },
  },
} as const;

function nullableNumber() { 
  return { type: ["number", "null"] };
}

type ModelPayload = {
  revenue: number | null;
  operating_profit: number | null;
  net_profit: number | null;
  total_assets: number | null;
  fixed_assets: number | null;
  current_assets: number | null;
  total_equity: number | null;
  total_liabilities: number | null;
  long_term_debt: number | null;
  short_term_debt: number | null;
  cash_and_equivalents: number | null;
  inventory: number | null;
  depreciation: number | null;
  employees_fte: number | null;
};

/**
 * Result of one PDF extraction attempt. Carries both the parsed
 * statement (null if parsing/LLM failed) and the Supabase Storage
 * path the original PDF was uploaded to (null if upload was skipped
 * or failed). The two are independent — a stored PDF with no
 * statement is still useful as an audit copy.
 */
export type ExtractResult = {
  statement: FinancialStatement | null;
  storagePath: string | null;
};

export class PdfExtractor {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly provider: LlmClient["provider"];

  constructor(
    private readonly nbb: NBBClient,
    opts?: { llm?: LlmClient },
  ) {
    const llm = opts?.llm ?? createLlmClient();
    if (llm === null) {
      throw new FinancialExtractionError(
        "No LLM provider configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY.",
      );
    }
    this.client = llm.client;
    this.model = llm.model;
    this.provider = llm.provider;
  }

  async extract(
    enterpriseNumber: string,
    ref: FilingReference,
  ): Promise<ExtractResult> {
    const noResult: ExtractResult = { statement: null, storagePath: null };

    let pdfBytes: Uint8Array | null;
    try {
      pdfBytes = await this.nbb.downloadPdf(ref.reference);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("pdf download failed", { reference: ref.reference, error: msg });
      return noResult;
    }
    if (!pdfBytes) {
      log.info("pdf unavailable — skipping", { reference: ref.reference });
      return noResult;
    }

    // Best-effort: persist the raw PDF in the annual-accounts bucket so
    // we keep an audit copy and don't have to re-download from NBB on
    // pipeline re-runs. Upload failures must not break extraction.
    let storagePath: string | null = null;
    const docs = DocumentRepository.create();
    if (docs !== null) {
      storagePath = await docs.upload(enterpriseNumber, ref.reference, pdfBytes);
      if (storagePath !== null) {
        log.info("pdf stored", { reference: ref.reference, path: storagePath });
      }
    }

    // The upload already succeeded (or was skipped). If anything below
    // fails, we still want the path returned so the pipeline can
    // persist it — the audit copy remains useful even when extraction
    // breaks. So failures from this point on yield {statement:null,
    // storagePath} rather than the all-null `noResult`.
    const storedOnly: ExtractResult = { statement: null, storagePath };

    let text: string;
    let pages = 0;
    try {
      const t0 = performance.now();
      // pdf-parse accepts a Buffer in node. Convert from Uint8Array.
      const parsed = await pdfParse(Buffer.from(pdfBytes));
      text = parsed.text ?? "";
      pages = parsed.numpages ?? 0;
      log.info("pdf parsed", {
        reference: ref.reference,
        pages,
        chars: text.length,
        ms: Math.round(performance.now() - t0),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("pdf-parse failed", { reference: ref.reference, error: msg });
      return storedOnly;
    }
    if (!text.trim()) {
      log.info("pdf text empty — skipping", { reference: ref.reference });
      return storedOnly;
    }

    const trimResult = trimToFinancialSection(text, MAX_TEXT_CHARS);
    log.debug("trim", {
      reference: ref.reference,
      anchor: trimResult.anchor,
      from: trimResult.startOffset,
      length: trimResult.text.length,
    });

    let payload: ModelPayload;
    try {
      payload = await log.time(`openai.extract ref=${ref.reference}`, () =>
        this.askModel(trimResult.text),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("openai extraction failed", { reference: ref.reference, error: msg });
      return storedOnly;
    }

    const filled = Object.values(payload).filter((v) => v !== null).length;
    log.info("statement extracted", {
      reference: ref.reference,
      provider: this.provider,
      model: this.model,
      filled,
      total: 14,
      revenue: payload.revenue,
      net_profit: payload.net_profit,
    });

    const statement = FinancialStatement.parse({
      enterprise_number: enterpriseNumber,
      reference: ref.reference,
      fiscal_year: fiscalYear(ref),
      exercise_start: ref.exercise_start,
      exercise_end: ref.exercise_end,
      currency: "EUR",
      revenue: payload.revenue,
      operating_profit: payload.operating_profit,
      net_profit: payload.net_profit,
      total_assets: payload.total_assets,
      fixed_assets: payload.fixed_assets,
      current_assets: payload.current_assets,
      total_equity: payload.total_equity,
      total_liabilities: payload.total_liabilities,
      long_term_debt: payload.long_term_debt,
      short_term_debt: payload.short_term_debt,
      cash_and_equivalents: payload.cash_and_equivalents,
      inventory: payload.inventory,
      depreciation: payload.depreciation,
      employees_fte: payload.employees_fte,
      source: "pdf",
      raw_headings: {},
    });
    return { statement, storagePath };
  }

  private async askModel(text: string): Promise<ModelPayload> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      response_format: {
        type: "json_schema",
        json_schema: RESPONSE_SCHEMA,
      },
      temperature: 0,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new FinancialExtractionError("OpenAI returned an empty response.");
    }
    return JSON.parse(content) as ModelPayload;
  }
}

type TrimResult = {
  text: string;
  startOffset: number;
  anchor: string | null;
};

/**
 * Locate the financial-statement section in the PDF text and return a
 * slice no longer than `maxChars`. Belgian filings put boilerplate
 * (identification, attestations) before the numeric sections, so
 * blindly taking the head of the document wastes tokens. We anchor on
 * common section headers and fall back to head-of-doc on no match.
 *
 * Returns the slice + the matched anchor (or null) for logging.
 */
function trimToFinancialSection(full: string, maxChars: number): TrimResult {
  let start = 0;
  let anchor: string | null = null;
  for (const re of SECTION_ANCHORS) {
    const m = full.match(re);
    if (m && m.index !== undefined) {
      start = m.index;
      anchor = m[0];
      break;
    }
  }
  return {
    text: full.slice(start, start + maxChars),
    startOffset: start,
    anchor,
  };
}
