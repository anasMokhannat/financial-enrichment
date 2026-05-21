/**
 * GET /api/companies
 *
 * Paginated list of every company in Supabase. Cache-only — never
 * runs the pipeline. Returns 503 when Supabase isn't configured.
 */

import type { NextRequest } from "next/server";

import { EnrichmentRepository } from "@/lib/server/db/repository";
import { errorResponse, fail, ok } from "@/lib/server/http";

// Always re-query Supabase so deletes/inserts are visible immediately.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url);

  const limit = Math.min(
    Math.max(Number(searchParams.get("limit") ?? "50"), 1),
    200,
  );
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);

  const repo = EnrichmentRepository.create();
  if (repo === null) {
    return fail(
      503,
      "Supabase not configured; companies list requires the cache.",
    );
  }
  try {
    const { rows, total } = await repo.listCompanies({ limit, offset });
    const enterpriseNumbers = rows.map((r) => r.enterprise_number);
    const counts = await repo.statementCountsByEnterprise(enterpriseNumbers);

    const items = rows.map((r) => ({
      enterprise_number: r.enterprise_number,
      name: r.name,
      trade_name: r.trade_name,
      legal_form: r.legal_form,
      status: r.status,
      dissolution_date: r.dissolution_date,
      last_refreshed_at: r.last_refreshed_at,
      statement_count: counts[r.enterprise_number] ?? 0,
    }));

    return ok({ items, total, limit, offset });
  } catch (err) {
    return errorResponse(err);
  }
}
