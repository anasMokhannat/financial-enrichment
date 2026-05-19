/**
 * GET /api/stats
 *
 * Aggregate counts powering the Overview tiles. Reads Supabase only,
 * never runs the pipeline. Returns 503 when Supabase isn't configured
 * so the frontend can render an honest empty state.
 */

import { EnrichmentRepository } from "@/lib/server/db/repository";
import { errorResponse, fail, ok } from "@/lib/server/http";

export async function GET(): Promise<Response> {
  const repo = EnrichmentRepository.create();
  if (repo === null) {
    return fail(503, "Supabase not configured; /stats requires the cache.");
  }
  try {
    const [companies, statements, latest] = await Promise.all([
      repo.countCompanies(),
      repo.countStatements(),
      repo.latestExtractionAt(),
    ]);
    return ok({
      companies_cached: companies,
      filings_extracted: statements,
      last_extraction_at: latest,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
