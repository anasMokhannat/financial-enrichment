/**
 * End-to-end orchestrator: company name -> CBE -> filings -> financials.
 *
 * Port of backend/src/pipeline.py. The XBRL chain is now the only
 * extraction path — when XBRL is absent (older filings, abbreviated
 * schema with no XBRL), the filing is still listed but the statement
 * carries no values. The Python LLM-on-PDF and regex-on-PDF fallbacks
 * are gone, deliberately.
 */

import { KBOScraper } from "./kbo/scraper";
import { NBBClient } from "./nbb/client";
import { XbrlExtractor } from "./extraction/xbrl";
import {
  type Company,
  type CompanyFinancialReport,
  type FinancialStatement,
} from "./models";

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

    notify("Resolving company in KBO");
    const kbo = new KBOScraper();
    const company: Company = await kbo.lookup(query);

    notify("Fetching filing references from NBB");
    const nbb = new NBBClient();
    const references = await nbb.latestReferences(
      company.enterprise_number,
      nFilings,
    );

    notify(`Extractor: XBRL (chain: ${references.length} filing(s))`);
    const extractor = new XbrlExtractor(nbb);

    const statements: FinancialStatement[] = [];
    let i = 0;
    for (const ref of references) {
      i++;
      notify(`Extracting filing ${i}/${references.length} (ref ${ref.reference})`);
      const stmt = await extractor.extract(company.enterprise_number, ref);
      if (stmt !== null) statements.push(stmt);
    }

    notify("Done");
    return { company, filings: references, statements };
  }
}
