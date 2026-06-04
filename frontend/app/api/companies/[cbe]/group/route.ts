/**
 * GET /api/companies/[cbe]/group
 *
 * Returns the corporate-group graph for *cbe* one hop in each direction:
 *
 *   parents      — companies that sit on this company's board as
 *                  corporate directors (i.e. THEY direct US → they are
 *                  our parents). Read from company.corporate_mandates.
 *
 *   subsidiaries — companies that have THIS company on their board
 *                  (i.e. WE direct THEM → they are our subsidiaries).
 *                  Read via the reverse index on corporate_mandates.
 *
 * Pure Supabase reads — no scraping. A node's `in_cache` flag tells the
 * UI whether we have a full record for that CBE (clickable) or only a
 * name from the mandate row (display-only).
 */

import type { NextRequest } from "next/server";

import { tryNormaliseAnyId } from "@/lib/server/companyId";
import { EnrichmentRepository } from "@/lib/server/db/repository";
import { errorResponse, fail, ok } from "@/lib/server/http";
import { createLogger } from "@/lib/server/log";

const log = createLogger("route:group");

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ cbe: string }> },
): Promise<Response> {
  const { cbe } = await context.params;
  const cbeNorm = tryNormaliseAnyId(cbe);
  if (cbeNorm === null) {
    return fail(400, `Not a valid CBE or SIREN: ${JSON.stringify(cbe)}`);
  }

  const repo = EnrichmentRepository.create();
  if (repo === null) {
    return fail(503, "Supabase not configured; group endpoint requires the cache.");
  }

  try {
    const company = await repo.getCompany(cbeNorm);
    if (company === null) {
      return fail(404, `No cached company for ${cbeNorm}.`);
    }

    // Parents = CBEs that direct US. Resolve cached display names so the
    // UI can label them without making the user open each one.
    const parentCbes = company.corporate_mandates.map(
      (m) => m.holder_enterprise_number,
    );
    const cachedNames = await repo.getNamesByCbe(parentCbes);

    const parents = company.corporate_mandates.map((m) => {
      const cachedName = cachedNames[m.holder_enterprise_number] ?? null;
      return {
        enterprise_number: m.holder_enterprise_number,
        // Prefer the cache-resolved canonical name; fall back to the
        // name KBO embedded next to the CBE on this company's page.
        name: cachedName ?? m.holder_name,
        role: m.role,
        since: m.since,
        in_cache: cachedName !== null,
      };
    });

    const subs = await repo.findSubsidiaries(cbeNorm);
    const subsidiaries = subs.map((s) => ({
      enterprise_number: s.enterprise_number,
      name: s.name,
      role: s.role,
      since: s.since,
      in_cache: true, // it's already in `companies` if we found it via the inner-join
    }));

    log.info("group resolved", {
      cbe: cbeNorm,
      parents: parents.length,
      subsidiaries: subsidiaries.length,
    });

    return ok({
      self: {
        enterprise_number: company.enterprise_number,
        name: company.name,
      },
      parents,
      subsidiaries,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
