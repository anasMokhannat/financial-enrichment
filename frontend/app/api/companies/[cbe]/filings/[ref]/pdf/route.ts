/**
 * GET /api/companies/[cbe]/filings/[ref]/pdf
 *
 * Returns a short-lived signed URL pointing at the stored PDF for one
 * filing. The bucket is private; we never expose the raw object URL.
 *
 * Response: { signed_url: string, expires_in: number }
 * 404 when the filing row has no `storage_path` (PDF never uploaded
 * because the company hasn't been enriched, or the bucket upload
 * failed at extraction time — Refresh the company to retry).
 */

import {
  DocumentRepository,
  EnrichmentRepository,
} from "@/lib/server/db/repository";
import { tryNormalise } from "@/lib/server/enterpriseNumber";
import { fail, ok } from "@/lib/server/http";

const SIGNED_URL_TTL_SECONDS = 3600;

export async function GET(
  _req: Request,
  context: { params: Promise<{ cbe: string; ref: string }> },
): Promise<Response> {
  const { cbe, ref } = await context.params;
  const cbeNorm = tryNormalise(cbe);
  if (cbeNorm === null) {
    return fail(400, `Not a valid CBE: ${JSON.stringify(cbe)}`);
  }
  const reference = ref.trim();
  if (!reference) {
    return fail(400, "Filing reference is required.");
  }

  const enrichment = EnrichmentRepository.create();
  const docs = DocumentRepository.create();
  if (enrichment === null || docs === null) {
    return fail(503, "Supabase is not configured.");
  }

  let filings;
  try {
    filings = await enrichment.getFilings(cbeNorm);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(500, message);
  }

  const match = filings.find((f) => f.reference === reference);
  if (!match) {
    return fail(
      404,
      `Filing ${reference} not found for ${cbeNorm}.`,
    );
  }
  if (!match.storage_path) {
    return fail(
      404,
      `Filing ${reference} has no stored PDF. Refresh the company to re-run the pipeline.`,
    );
  }

  const signedUrl = await docs.signedUrl(
    match.storage_path,
    SIGNED_URL_TTL_SECONDS,
  );
  if (!signedUrl) {
    return fail(
      500,
      `Could not generate a signed URL for filing ${reference}.`,
    );
  }

  return ok({
    signed_url: signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
  });
}
