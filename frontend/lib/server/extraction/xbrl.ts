/**
 * XBRL-backed financial extractor.
 *
 * Port of backend/src/extraction/xbrl_extractor.py. The NBB Authentic
 * Data Query exposes XBRL for every full-schema (VOL) filing since
 * 2007, with tagged Belgian-GAAP facts that carry the canonical NBB
 * heading code in their element name. That makes value extraction:
 *
 *   - deterministic — no LLM inference required;
 *   - fast — local parse, no network round-trip beyond fetching the
 *     XBRL file once; and
 *   - exact — no rounding from PDF-text re-parsing.
 *
 * Coverage caveat: abbreviated and micro filings have spotty XBRL
 * support; pre-2007 filings have none. When NBB returns 404 or the
 * file has no recognisable facts, this extractor returns `null` and
 * the pipeline emits an empty `unknown`-source statement.
 *
 * Element-name strategy
 * ---------------------
 * Belgian XBRL files use the BeNGAAP taxonomy. Concept local names
 * embed the NBB code somewhere — exact form varies between taxonomy
 * versions (`HeadingCode70`, `Code_20_58`, `Turnover_70`). We scan
 * every fact's local name for a digit-run that looks like a heading
 * code and look it up. New taxonomy revisions keep working as long
 * as they keep the code in the element name.
 *
 * Code disambiguation (FIX #1)
 * ----------------------------
 * A naive "first digit-run wins" approach confuses parent totals with
 * sub-items: `Code620_Remuneration` contains both `620` (direct pay,
 * a sub-item) and could match `62` (total personnel costs) if not
 * anchored. We use a strict regex with non-digit boundaries and
 * prefer the longest matching code — the longer code is always the
 * more specific sub-item, never the parent total.
 *
 * Context handling (FIX #2)
 * -------------------------
 * Belgian XBRL carries multiple contexts even for a single fiscal
 * year: an "instant" context for the balance-sheet date and a
 * "duration" context for the P&L period. Filtering on a single
 * contextRef drops half the facts. We instead identify all contexts
 * whose period endDate falls in the latest fiscal year and accept
 * facts from any of them. Match on year, not exact date, because the
 * social-balance section sometimes uses an off-by-one-day endDate.
 *
 * Post-extraction validation (FIX #3)
 * -----------------------------------
 * The balance sheet obeys rigid accounting identities. After
 * extraction we run them as a sanity check and log warnings on any
 * drift — the cheapest way to detect a code-mapping bug or a unit-
 * scaling issue.
 */

import { XMLParser } from "fast-xml-parser";

import {
  CODE_TO_FIELD,
  FIELD_TO_CANONICAL_CODE,
  HEADING_MAP,
  SEMANTIC_NAME_TO_FIELD,
} from "./headings";
import { fiscalYear, FinancialStatement, FilingReference } from "../models";
import type { NBBClient } from "../nbb/client";

/**
 * Heading-code pattern: 2-5 digits, optionally followed by "/" + 1-3
 * digits OR "_" + 1-3 digits (XML local names can't contain "/").
 * Non-digit boundaries on both sides so "620" doesn't slice out of
 * "62000" and "70" doesn't grab out of "70A12".
 */
const CODE_RE = /(?<!\d)(\d{2,5}(?:[/_]\d{1,3})?)(?!\d)/g;

/** Tolerance (in EUR) for accounting-identity validation. */
const VALIDATION_TOLERANCE = 2;

type ParsedNode = {
  /** Fully-qualified tag (with the namespace, separated by ":"). */
  tag: string;
  /** Local name (the part after any ":"). */
  localName: string;
  /** XBRL `contextRef` attribute, if present. */
  contextRef: string | null;
  /** XBRL `decimals` attribute, if present. */
  decimalsAttr: string | null;
  /** Element text content (already trimmed). May be empty. */
  text: string;
  /** Element id attribute (used to identify <xbrli:context> nodes). */
  id: string | null;
  /** Child nodes, in document order. */
  children: ParsedNode[];
};

/**
 * Permissive numeric parser for XBRL fact values.
 *
 * XBRL mandates "." as decimal separator with no thousands separators,
 * but some Belgian filings leak the locale's comma decimal (code 9087
 * — average FTE headcount, e.g. "457,9"). We try strict first and fall
 * back to a European-style parse.
 */
function parseXbrlNumber(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const strict = Number(t);
  if (Number.isFinite(strict)) return strict;
  let cleaned = t.replace(/[ \xa0]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }
  const fallback = Number(cleaned);
  return Number.isFinite(fallback) ? fallback : null;
}

/**
 * Apply the XBRL `decimals` attribute as a power-of-ten scaling.
 *
 * Spec: `decimals` is the number of digits to the right of the decimal
 * point that are accurate. Negative values indicate truncation:
 * `decimals="-3"` means accurate to the nearest thousand, so a reported
 * "1996" should be read as 1_996_000. BNB filings almost always use
 * `decimals="0"` (exact euros) but we handle the general case.
 */
function applyDecimalsScaling(value: number, attr: string | null): number {
  if (attr === null || attr === "INF") return value;
  const d = Number.parseInt(attr, 10);
  if (!Number.isFinite(d)) return value;
  if (d >= 0) return value;
  return value * Math.pow(10, -d);
}

/**
 * Find the heading code (or synthetic canonical code) for a fact.
 *
 * Two strategies, in order:
 *   1. Digit-based scan of the element local name. Older BeNGAAP
 *      taxonomies name elements like `HeadingCode_20_28` or `Code70_Turnover`.
 *      FIX #1: prefer the longest digit-run when multiple match.
 *   2. Semantic-name lookup. Newer C-ASBL / VOL filings use purely
 *      semantic element names (`Turnover`, `Equity`, `CashBankHand`)
 *      with no digits. Map via SEMANTIC_NAME_TO_FIELD and return the
 *      canonical code for that field.
 *
 * We deliberately do NOT scan contextRef — dimensional filings use
 * context ids like `c70` that happen to look like NBB codes.
 */
function codeFor(localName: string): string | null {
  const candidates: string[] = [];
  for (const match of localName.matchAll(CODE_RE)) {
    const candidate = match[1].replace(/_/g, "/");
    if (CODE_TO_FIELD[candidate] !== undefined) {
      candidates.push(candidate);
    }
  }
  if (candidates.length > 0) {
    // Longest wins. Ties broken by first occurrence.
    let best = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].length > best.length) best = candidates[i];
    }
    return best;
  }
  const field = SEMANTIC_NAME_TO_FIELD[localName];
  if (field !== undefined) return FIELD_TO_CANONICAL_CODE[field] ?? null;
  return null;
}

/** Strip the namespace prefix from a tag. */
function localOf(tag: string): string {
  const idx = tag.indexOf(":");
  return idx === -1 ? tag : tag.slice(idx + 1);
}

/**
 * Parse the XBRL document into a uniform tree of `ParsedNode`s.
 *
 * fast-xml-parser returns a JSON-style object where attributes live
 * under `@_*` keys, text under `#text`, and children as nested keys.
 * Walking that recursively gives us back a tree we can iterate in
 * document order without caring about the underlying shape.
 */
function parseXbrlTree(xbrlBytes: Uint8Array): ParsedNode | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    preserveOrder: true,
    trimValues: true,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    parseTagValue: false,
  });
  const text = new TextDecoder("utf-8").decode(xbrlBytes);
  const ordered = parser.parse(text) as unknown[];
  if (!Array.isArray(ordered) || ordered.length === 0) return null;

  function toNode(entry: unknown): ParsedNode | null {
    if (!entry || typeof entry !== "object") return null;
    const obj = entry as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) return null;
    const tag = keys[0];
    const childArray = Array.isArray(obj[tag]) ? (obj[tag] as unknown[]) : [];
    const attrs = (obj[":@"] as Record<string, string> | undefined) ?? {};

    let text = "";
    const children: ParsedNode[] = [];
    for (const child of childArray) {
      if (!child || typeof child !== "object") continue;
      const childObj = child as Record<string, unknown>;
      if (typeof childObj["#text"] === "string") {
        text += childObj["#text"];
      } else {
        const subNode = toNode(child);
        if (subNode) children.push(subNode);
      }
    }

    return {
      tag,
      localName: localOf(tag),
      contextRef: (attrs["@_contextRef"] as string | undefined) ?? null,
      decimalsAttr: (attrs["@_decimals"] as string | undefined) ?? null,
      text: text.trim(),
      id: (attrs["@_id"] as string | undefined) ?? null,
      children,
    };
  }

  // Skip XML processing instructions / declarations at the top level.
  for (const entry of ordered) {
    const node = toNode(entry);
    if (node) return node;
  }
  return null;
}

/** Yield every node in document order, including the root. */
function* walk(node: ParsedNode): Generator<ParsedNode> {
  yield node;
  for (const child of node.children) {
    yield* walk(child);
  }
}

/**
 * Return all context ids whose period falls in the target fiscal year.
 *
 * Belgian XBRL includes at minimum an instant context for the
 * balance-sheet date and a duration context for the fiscal year, plus
 * sometimes a social-balance context with an endDate off by a day. We
 * match on year only.
 *
 * When `targetYear` is null we infer it from the latest endDate seen.
 */
function pickCurrentContexts(
  root: ParsedNode,
  targetYear: number | null,
): Set<string> {
  const ctxEnds = new Map<string, string>();

  for (const node of walk(root)) {
    // Only the <xbrli:context> elements (or any 'context' in the XBRL
    // instance namespace) matter here. Use the local name to remain
    // namespace-prefix-agnostic.
    if (node.localName !== "context") continue;
    if (node.id === null) continue;

    // Walk children to find endDate or instant.
    let endText: string | null = null;
    for (const descendant of walk(node)) {
      const lname = descendant.localName;
      if (lname === "endDate" || lname === "instant") {
        if (descendant.text) {
          endText = descendant.text;
          break;
        }
      }
    }
    if (endText !== null) ctxEnds.set(node.id, endText);
  }

  if (ctxEnds.size === 0) return new Set();

  let yearStr: string;
  if (targetYear !== null) {
    yearStr = String(targetYear);
  } else {
    let latest = "";
    for (const end of ctxEnds.values()) {
      if (end > latest) latest = end;
    }
    yearStr = latest.slice(0, 4);
  }

  const out = new Set<string>();
  for (const [id, end] of ctxEnds) {
    if (end.startsWith(yearStr)) out.add(id);
  }
  return out;
}

/**
 * Walk every fact and return `code → value` for the current fiscal year.
 *
 * Conflict resolution: when multiple values map to the same code, keep
 * the one with the largest absolute magnitude. Heuristic but reliable
 * on Belgian filings — a prior-year restatement is usually smaller
 * than the current-year final, and multi-period aggregates (rare) tend
 * to be larger still.
 */
function extractFacts(
  root: ParsedNode,
  currentContexts: Set<string>,
): Map<string, number> {
  const seen = new Map<string, number[]>();

  for (const node of walk(root)) {
    if (node.contextRef === null) continue;
    if (!currentContexts.has(node.contextRef)) continue;
    if (!node.text) continue;

    const rawValue = parseXbrlNumber(node.text);
    if (rawValue === null) continue;

    const value = applyDecimalsScaling(rawValue, node.decimalsAttr);
    const code = codeFor(node.localName);
    if (code === null) continue;

    const list = seen.get(code);
    if (list) list.push(value);
    else seen.set(code, [value]);
  }

  const out = new Map<string, number>();
  for (const [code, values] of seen) {
    if (values.length === 1) {
      out.set(code, values[0]);
      continue;
    }
    const unique = Array.from(new Set(values));
    if (unique.length === 1) {
      out.set(code, unique[0]);
      continue;
    }
    let best = values[0];
    for (const v of values) {
      if (Math.abs(v) > Math.abs(best)) best = v;
    }
    console.warn(
      `XBRL fact code ${code} had conflicting values ${JSON.stringify(unique)}; ` +
        `keeping the largest by magnitude (${best})`,
    );
    out.set(code, best);
  }
  return out;
}

/** Decimal → wire-string. Drops trailing zeros from the JS Number repr. */
function toWireString(value: number): string {
  // Match Pydantic's Decimal-as-string behaviour: full precision, no
  // scientific notation for the range we deal with (single-digit
  // millions to billions of euros).
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return value.toString();
  // Avoid 1e-7 style output by going through fixed and trimming.
  const fixed = value.toFixed(6);
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

function buildStatement(opts: {
  enterpriseNumber: string;
  ref: FilingReference;
  factsByCode: Map<string, number>;
}): FinancialStatement {
  const values: Record<string, string | null> = {};
  for (const [field, codes] of Object.entries(HEADING_MAP)) {
    values[field] = null;
    for (const code of codes) {
      const v = opts.factsByCode.get(code);
      if (v !== undefined) {
        values[field] = toWireString(v);
        break;
      }
    }
  }

  const rawHeadings: Record<string, string> = {};
  for (const [code, v] of opts.factsByCode) {
    rawHeadings[code] = toWireString(v);
  }

  return FinancialStatement.parse({
    enterprise_number: opts.enterpriseNumber,
    reference: opts.ref.reference,
    fiscal_year: fiscalYear(opts.ref),
    exercise_start: opts.ref.exercise_start,
    exercise_end: opts.ref.exercise_end,
    currency: "EUR",
    revenue: values.revenue,
    operating_profit: values.operating_profit,
    net_profit: values.net_profit,
    total_assets: values.total_assets,
    fixed_assets: values.fixed_assets,
    current_assets: values.current_assets,
    total_equity: values.total_equity,
    total_liabilities: values.total_liabilities,
    long_term_debt: values.long_term_debt,
    short_term_debt: values.short_term_debt,
    cash_and_equivalents: values.cash_and_equivalents,
    inventory: values.inventory,
    depreciation: values.depreciation,
    employees_fte: values.employees_fte,
    source: "xbrl",
    raw_headings: rawHeadings,
  });
}

/**
 * Run accounting-identity sanity checks; return human-readable warnings.
 *
 * Identities (must hold within rounding tolerance):
 *   1. total_assets       = fixed_assets + current_assets
 *   2. total_assets       = total_equity + total_liabilities + provisions
 *   3. total_liabilities  = long_term_debt + short_term_debt
 *
 * A breach signals either an extraction bug (wrong code mapped) or a
 * unit-scaling problem. Non-fatal — we log and continue.
 */
function validateAccountingIdentities(stmt: FinancialStatement): string[] {
  const warnings: string[] = [];
  const num = (v: string | null): number | null =>
    v === null ? null : Number(v);

  const ta = num(stmt.total_assets);
  const fa = num(stmt.fixed_assets);
  const ca = num(stmt.current_assets);
  const eq = num(stmt.total_equity);
  const tl = num(stmt.total_liabilities);
  const lt = num(stmt.long_term_debt);
  const st = num(stmt.short_term_debt);

  const diff = (l: number, r: number): number => Math.abs(l - r);

  if (ta !== null && fa !== null && ca !== null) {
    const drift = diff(ta, fa + ca);
    if (drift > VALIDATION_TOLERANCE) {
      warnings.push(
        `Balance-sheet identity 1 violated: total_assets=${ta} vs fixed+current=${fa + ca} (drift=${drift})`,
      );
    }
  }
  if (ta !== null && eq !== null && tl !== null) {
    const expected = eq + tl;
    const drift = diff(ta, expected);
    if (drift > VALIDATION_TOLERANCE) {
      warnings.push(
        `Balance-sheet identity 2 violated: total_assets=${ta} vs equity+liab=${expected} (drift=${drift})`,
      );
    }
  }
  if (tl !== null && (lt !== null || st !== null)) {
    const expected = (lt ?? 0) + (st ?? 0);
    const drift = diff(tl, expected);
    if (drift > VALIDATION_TOLERANCE) {
      warnings.push(
        `Liability split violated: total_liabilities=${tl} vs long+short=${expected} (drift=${drift})`,
      );
    }
  }
  return warnings;
}

export class XbrlExtractor {
  constructor(private readonly nbb: NBBClient) {}

  async extract(
    enterpriseNumber: string,
    ref: FilingReference,
  ): Promise<FinancialStatement | null> {
    let xbrlBytes: Uint8Array | null;
    try {
      xbrlBytes = await this.nbb.downloadXbrl(ref.reference);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`XBRL download failed for ${ref.reference}: ${msg}`);
      return null;
    }
    if (!xbrlBytes) {
      console.info(
        `XBRL not available for ${ref.reference}; chain will fall through`,
      );
      return null;
    }

    let root: ParsedNode | null;
    try {
      root = parseXbrlTree(xbrlBytes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`XBRL parse failed for ${ref.reference}: ${msg}`);
      return null;
    }
    if (root === null) {
      console.warn(`XBRL parse for ${ref.reference} yielded no root element`);
      return null;
    }

    const targetYear = fiscalYear(ref);
    const currentContexts = pickCurrentContexts(root, targetYear);
    if (currentContexts.size === 0) {
      console.info(`XBRL for ${ref.reference} has no datable contexts`);
      return null;
    }

    const facts = extractFacts(root, currentContexts);
    if (facts.size === 0) {
      let total = 0;
      for (const _ of walk(root)) total++;
      console.info(
        `XBRL for ${ref.reference} had no recognised heading-code facts (${total} total elements scanned)`,
      );
      return null;
    }

    const statement = buildStatement({
      enterpriseNumber,
      ref,
      factsByCode: facts,
    });

    for (const warning of validateAccountingIdentities(statement)) {
      console.warn(`XBRL validation [${ref.reference}]: ${warning}`);
    }

    return statement;
  }
}

// Expose the small pure helpers for unit-testing.
export const _testing = {
  parseXbrlNumber,
  applyDecimalsScaling,
  codeFor,
  pickCurrentContexts,
  extractFacts,
  validateAccountingIdentities,
  parseXbrlTree,
};
