/**
 * GET / PUT /api/profile
 *
 * Singleton app-profile endpoint. Stores the user's own company info
 * and ICP — the analyzer reads this row to bias the commercial-fit
 * verdict toward what the salesperson actually wants.
 *
 * No auth for v1; whoever can hit the deployment edits the same row.
 */

import type { NextRequest } from "next/server";

import { ProfileRepository } from "@/lib/server/db/repository";
import { fail, ok } from "@/lib/server/http";
import { AppProfile } from "@/lib/server/models";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<Response> {
  const repo = ProfileRepository.create();
  if (repo === null) {
    return fail(503, "Supabase is not configured.");
  }
  try {
    const profile = await repo.get();
    return ok(profile);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(500, message);
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const repo = ProfileRepository.create();
  if (repo === null) {
    return fail(503, "Supabase is not configured.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }

  // Parse through the schema so unknown fields are dropped and defaults
  // fill in any missing strings. Throws ZodError on bad input.
  let parsed;
  try {
    parsed = AppProfile.parse(body ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "Validation failed";
    return fail(400, message);
  }

  try {
    const saved = await repo.upsert(parsed);
    return ok(saved);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(500, message);
  }
}
