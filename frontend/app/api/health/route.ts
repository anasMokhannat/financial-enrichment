/**
 * GET /api/health
 *
 * Boot-time capability snapshot. Returns 200 regardless of which
 * services are wired up; the body tells the caller what's available.
 * Mirrors the Python /health endpoint.
 */

import { hasNbb, hasOpenAI, hasSupabase } from "@/lib/server/config";
import { ok } from "@/lib/server/http";

export async function GET(): Promise<Response> {
  return ok({
    status: "ok",
    services: {
      nbb: hasNbb(),
      openai: hasOpenAI(),
      supabase: hasSupabase(),
    },
  });
}
