/**
 * End-to-end orchestrator: company name -> CBE -> filings -> financials.
 *
 * Active extraction path: PDF + OpenAI structured outputs (see
 * extraction/pdf.ts). For every NBB filing reference we download the
 * PDF deliverable, run pdf-parse to get the text, and ask OpenAI to
 * fill the FinancialStatement schema. The XBRL extractor is kept on
 * disk (extraction/xbrl.ts) but no longer wired into the pipeline.
 */

import { KBOScraper } from "./kbo/scraper";
import { NBBClient } from "./nbb/client";
import { NoFilingsError } from "./errors";
import { PdfExtractor } from "./extraction/pdf";
import { createLogger } from "./log";
import {
  type Company,
  type CompanyFinancialReport,
  type FinancialStatement,
} from "./models";

const log = createLogger("pipeline");

export type ProgressCallback = (msg: string) => void;

export type PipelineOptions = {
  filingsToRead?: number;
  onProgress?: ProgressCallback;
};

const DEFAULT_FILINGS_TO_READ = 3;

export class EnrichmentPipeline {
  /**
   * Resolve *query* (name or 10-digit CBE) into a full report.
   *
   * KBO ambiguity surfaces as {@link AmbiguousMatchError} from the
   * scraper — callers convert it to a 409. KBO not-found surfaces as
   * a generic KBOScraperError; the route handler maps it to 404.
   */
  async run(
    query: string,
    opts?: PipelineOptions,
  ): Promise<CompanyFinancialReport> {
    const notify = opts?.onProgress ?? (() => {});
    const nFilings = opts?.filingsToRead ?? DEFAULT_FILINGS_TO_READ;

    log.info("run start", { query, filings: nFilings });
    const startTotal = performance.now();

    notify("Resolving company in KBO");
    const kbo = new KBOScraper();
    const company: Company = await log.time("kbo.lookup", () => kbo.lookup(query));
    log.info("kbo resolved", {
      cbe: company.enterprise_number,
      name: company.name,
      nace: company.nace_codes.length,
      functions: company.functions.length,
      corporate_mandates: company.corporate_mandates.length,
    });

    notify("Fetching filing references from NBB");
    const nbb = new NBBClient();
    const references = await log.time("nbb.latestReferences", () =>
      nbb.latestReferences(company.enterprise_number, nFilings),
    );
    log.info("nbb references", {
      cbe: company.enterprise_number,
      count: references.length,
      refs: references.map((r) => r.reference),
    });

    if (references.length === 0) {
      log.warn("no filings", { cbe: company.enterprise_number });
      throw new NoFilingsError({
        enterprise_number: company.enterprise_number,
        name: company.name,
      });
    }

    notify(`Extractor: PDF+LLM (${references.length} filing(s))`);
    const extractor = new PdfExtractor(nbb);

    const statements: FinancialStatement[] = [];
    let i = 0;
    for (const ref of references) {
      i++;
      notify(`Extracting filing ${i}/${references.length} (ref ${ref.reference})`);
      const stmt = await log.time(`extract ${i}/${references.length} ref=${ref.reference}`, () =>
        extractor.extract(company.enterprise_number, ref),
      );
      if (stmt !== null) {
        statements.push(stmt);
      } else {
        log.warn("extract returned null", { ref: ref.reference });
      }
    }

    notify("Done");
    log.info("run end", {
      cbe: company.enterprise_number,
      filings: references.length,
      statements: statements.length,
      ms: Math.round(performance.now() - startTotal),
    });
    return { company, filings: references, statements };
  }
}
