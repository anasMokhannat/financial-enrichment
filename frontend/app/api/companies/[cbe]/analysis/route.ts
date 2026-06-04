/**
 * GET /api/companies/[cbe]/analysis
 *
 * Return the cached commercial-fit analysis, or 404 if not generated.
 * The frontend's panel uses this to render existing analyses without
 * paying the OpenAI cost every page load.
 */

import { AnalysisRepository } from "@/lib/server/db/repository";
import { tryNormaliseAnyId } from "@/lib/server/companyId";
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
  const repo = AnalysisRepository.create();
  if (repo === null) {
    return fail(503, "Supabase not configured; analyses are stored there.");
  }
  try {
    const analysis = await repo.get(cbeNorm);
    if (analysis === null) {
      return fail(
        404,
        `No analysis cached for ${cbeNorm}. POST /api/companies/${cbeNorm}/analyze to generate one.`,
      );
    }
    return ok(analysis);
  } catch (err) {
    return errorResponse(err);
  }
}
