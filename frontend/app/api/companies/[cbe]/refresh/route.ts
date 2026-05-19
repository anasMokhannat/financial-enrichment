/**
 * POST /api/companies/[cbe]/refresh?filings=2
 *
 * Force a fresh pipeline run for *cbe* and update Supabase.
 * Mirrors the Python /refresh endpoint.
 */

import type { NextRequest } from "next/server";

import { EnrichmentRepository } from "@/lib/server/db/repository";
import { tryNormalise } from "@/lib/server/enterpriseNumber";
import { errorResponse, extractorName, fail, ok } from "@/lib/server/http";
import { EnrichmentPipeline } from "@/lib/server/pipeline";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ cbe: string }> },
): Promise<Response> {
  const { cbe } = await context.params;
  const cbeNorm = tryNormalise(cbe);
  if (cbeNorm === null) {
    return fail(400, `Not a valid CBE: ${JSON.stringify(cbe)}`);
  }

  const { searchParams } = new URL(req.url);
  const filingsParam = searchParams.get("filings");
  const filings = filingsParam !== null
    ? Math.min(Math.max(Number(filingsParam), 1), 20)
    : undefined;

  let report;
  try {
    const pipeline = new EnrichmentPipeline();
    report = await pipeline.run(cbeNorm, { filingsToRead: filings });
  } catch (err) {
    return errorResponse(err);
  }

  const repo = EnrichmentRepository.create();
  if (repo !== null) {
    try {
      await repo.saveReport(report, extractorName());
    } catch (err) {
      console.warn(`Failed to persist refreshed report for ${cbeNorm}:`, err);
    }
  }
  return ok(report);
}
