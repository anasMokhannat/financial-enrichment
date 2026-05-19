/**
 * GET /api/companies/[cbe]?refresh=false&filings=2
 *
 * Fetch a company by CBE. Mirrors /search but assumes the path
 * segment is already a CBE.
 */

import type { NextRequest } from "next/server";

import { EnrichmentRepository } from "@/lib/server/db/repository";
import { tryNormalise } from "@/lib/server/enterpriseNumber";
import { errorResponse, extractorName, fail, ok } from "@/lib/server/http";
import { EnrichmentPipeline } from "@/lib/server/pipeline";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ cbe: string }> },
): Promise<Response> {
  const { cbe } = await context.params;
  const cbeNorm = tryNormalise(cbe);
  if (cbeNorm === null) {
    return fail(400, `Not a valid CBE: ${JSON.stringify(cbe)}`);
  }

  const { searchParams } = new URL(req.url);
  const refresh = searchParams.get("refresh") === "true";
  const filingsParam = searchParams.get("filings");
  const filings = filingsParam !== null
    ? Math.min(Math.max(Number(filingsParam), 1), 20)
    : undefined;

  const repo = EnrichmentRepository.create();
  if (repo !== null && !refresh) {
    try {
      const cached = await repo.getReport(cbeNorm);
      if (cached && cached.statements.length > 0) return ok(cached);
    } catch (err) {
      console.warn(`Cache read failed for ${cbeNorm}:`, err);
    }
  }

  let report;
  try {
    const pipeline = new EnrichmentPipeline();
    report = await pipeline.run(cbeNorm, { filingsToRead: filings });
  } catch (err) {
    return errorResponse(err);
  }

  if (repo !== null) {
    try {
      await repo.saveReport(report, extractorName());
    } catch (err) {
      console.warn(`Failed to persist report for ${cbeNorm}:`, err);
    }
  }
  return ok(report);
}
