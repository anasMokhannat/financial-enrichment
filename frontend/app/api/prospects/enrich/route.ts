/**
 * POST /api/prospects/enrich
 *
 * Body: { name: string, company_name?: string | null, domain?: string | null }
 *
 * Calls Apollo.io's people-match endpoint with the prospect's name +
 * company context and returns the enrichment result (email, title,
 * LinkedIn URL, …). The Apollo key is never exposed to the browser —
 * the client only ever sees this proxy.
 */

import type { NextRequest } from "next/server";

import { ApolloClient, ApolloError } from "@/lib/server/apollo/client";
import { createLogger } from "@/lib/server/log";
import { fail, ok } from "@/lib/server/http";

const log = createLogger("route:prospects.enrich");

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest): Promise<Response> {
  let body: { name?: unknown; company_name?: unknown; domain?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return fail(400, "name is required.");

  const companyName =
    typeof body.company_name === "string" && body.company_name.trim()
      ? body.company_name.trim()
      : null;
  const domain =
    typeof body.domain === "string" && body.domain.trim()
      ? body.domain.trim()
      : null;

  const client = ApolloClient.create();
  if (client === null) {
    log.warn("apollo not configured");
    return fail(503, "Apollo not configured (APOLLO_API_KEY missing).");
  }

  try {
    const result = await client.enrich({
      fullName: name,
      companyName,
      domain,
    });
    return ok(result);
  } catch (err) {
    if (err instanceof ApolloError) {
      return fail(err.status, err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error("enrich unexpected", { error: message });
    return fail(500, message);
  }
}
