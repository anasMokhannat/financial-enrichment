/**
 * GET /api/companies/[cbe]/filings
 *
 * Filing references for the company (cached only — does not call NBB).
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
  if (repo === null) return fail(503, "Supabase not configured.");
  try {
    return ok(await repo.getFilings(cbeNorm));
  } catch (err) {
    return errorResponse(err);
  }
}
