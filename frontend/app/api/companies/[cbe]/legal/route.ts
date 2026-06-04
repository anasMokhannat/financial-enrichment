/**
 * GET /api/companies/[cbe]/legal
 *
 * The legal-profile slice: company info + NACE + functions.
 * Reads Supabase only — does not run the pipeline. 404 if not cached.
 */

import { tryNormaliseAnyId } from "@/lib/server/companyId";
import { EnrichmentRepository } from "@/lib/server/db/repository";
import { errorResponse, fail, ok } from "@/lib/server/http";

export async function GET(
  _req: Request,
  context: { params: Promise<{ cbe: string }> },
): Promise<Response> {
  const { cbe } = await context.params;
  const cbeNorm = tryNormaliseAnyId(cbe);
  if (cbeNorm === null) {
    return fail(400, `Not a valid CBE or SIREN: ${JSON.stringify(cbe)}`);
  }
  const repo = EnrichmentRepository.create();
  if (repo === null) {
    return fail(503, "Supabase not configured; legal profile is cache-only.");
  }
  try {
    const company = await repo.getCompany(cbeNorm);
    if (company === null) {
      return fail(404, `No cached company for CBE ${cbeNorm}.`);
    }
    return ok(company);
  } catch (err) {
    return errorResponse(err);
  }
}
