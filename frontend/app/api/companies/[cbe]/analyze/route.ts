/**
 * POST /api/companies/[cbe]/analyze
 *
 * Run the LLM commercial-fit analyzer against the cached report and
 * persist the result. Returns 404 if the company isn't enriched yet
 * (caller should hit /search or /refresh first).
 */

import {
  AnalysisRepository,
  EnrichmentRepository,
  ProfileRepository,
} from "@/lib/server/db/repository";
import { tryNormaliseAnyId } from "@/lib/server/companyId";
import {
  AnalysisUnavailableError,
  CommercialAnalyzer,
} from "@/lib/server/analysis/analyzer";
import { errorResponse, fail, ok } from "@/lib/server/http";

export async function POST(
  _req: Request,
  context: { params: Promise<{ cbe: string }> },
): Promise<Response> {
  const { cbe } = await context.params;
  const cbeNorm = tryNormaliseAnyId(cbe);
  if (cbeNorm === null) {
    return fail(400, `Not a valid CBE: ${JSON.stringify(cbe)}`);
  }

  const analyzer = CommercialAnalyzer.create();
  if (analyzer === null) {
    return fail(
      503,
      "OPENAI_API_KEY not configured; the analyzer is unavailable.",
    );
  }
  const enrichment = EnrichmentRepository.create();
  const analyses = AnalysisRepository.create();
  if (enrichment === null || analyses === null) {
    return fail(
      503,
      "Supabase not configured; cannot read source data or persist analysis.",
    );
  }

  try {
    const report = await enrichment.getReport(cbeNorm);
    if (report === null) {
      return fail(
        404,
        `No cached company report for ${cbeNorm}. Search/refresh it first.`,
      );
    }

    // Pull the active profile (best-effort) so the analyzer biases its
    // verdict toward the user's stated ICP. A missing/failed read just
    // means the analyzer falls back to its profile-less behaviour.
    let profile = null;
    const profileRepo = ProfileRepository.create();
    if (profileRepo !== null) {
      try {
        profile = await profileRepo.get();
      } catch (err) {
        console.warn(`Profile read failed; continuing without:`, err);
      }
    }

    const analysis = await analyzer.analyze(report, { profile });
    try {
      await analyses.upsert(analysis);
    } catch (err) {
      console.warn(`Failed to persist analysis for ${cbeNorm}:`, err);
    }
    return ok(analysis);
  } catch (err) {
    if (err instanceof AnalysisUnavailableError) {
      return fail(422, err.message);
    }
    return errorResponse(err);
  }
}
