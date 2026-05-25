/**
 * GET /api/companies/search?q=...&refresh=false&filings=2
 *
 * Resolve a name or CBE to a CompanyFinancialReport.
 *
 * Cache strategy:
 *   1. If q is a CBE and refresh=false and Supabase is configured,
 *      serve from cache when present (with statements).
 *   2. Otherwise run the pipeline; persist back to Supabase.
 */

import type { NextRequest } from "next/server";

import { EnrichmentRepository } from "@/lib/server/db/repository";
import { tryNormalise } from "@/lib/server/enterpriseNumber";
import { errorResponse, extractorName, fail, ok } from "@/lib/server/http";
import { EnrichmentPipeline } from "@/lib/server/pipeline";

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) return fail(400, "q is required.");

  const refresh = searchParams.get("refresh") === "true";
  const filingsParam = searchParams.get("filings");
  const filings = filingsParam !== null
    ? Math.min(Math.max(Number(filingsParam), 1), 20)
    : undefined;

  // 4-digit Belgian postcode used to disambiguate name searches in KBO.
  // Ignored entirely on direct CBE lookups (the CBE is already unique).
  const rawPostal = (searchParams.get("postal_code") ?? "").trim();
  const postalCode = /^\d{4}$/.test(rawPostal) ? rawPostal : undefined;

  const cbe = tryNormalise(q);
  const repo = EnrichmentRepository.create();

  // 1. Cache fast-path. Trust the cache: if the company is persisted
  // at all, serve it. The previous `statements.length > 0` gate caused
  // every visit to re-scrape KBO + re-hit NBB + re-run PDF extraction
  // for companies whose extraction had produced 0 statements (failed,
  // abbreviated, etc.). The user has `?refresh=true` for forced re-runs.
  if (repo !== null && !refresh && cbe !== null) {
    try {
      const cached = await repo.getReport(cbe);
      if (cached) {
        return ok({
          query: q,
          report: cached,
          candidates: null,
          from_cache: true,
        });
      }
    } catch (err) {
      console.warn(`Cache read failed for ${cbe}:`, err);
    }
  }

  // 2. Run pipeline
  let report;
  try {
    const pipeline = new EnrichmentPipeline();
    report = await pipeline.run(q, { filingsToRead: filings, postalCode });
  } catch (err) {
    return errorResponse(err);
  }

  // 3. Persist back if Supabase is configured (best-effort)
  if (repo !== null) {
    try {
      await repo.saveReport(report, extractorName());
    } catch (err) {
      console.warn(
        `Failed to persist report for ${report.company.enterprise_number}:`,
        err,
      );
    }
  }

  return ok({ query: q, report, candidates: null, from_cache: false });
}
