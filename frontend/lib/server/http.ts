/**
 * Tiny helpers shared by every Route Handler.
 *
 * The handlers themselves stay focused on business logic — this module
 * absorbs the JSON-response boilerplate and the error→HTTP-status
 * mapping that mirrors what FastAPI did via custom exception handlers.
 */

import { NextResponse } from "next/server";

import {
  AmbiguousMatchError,
  KBOScraperError,
  NBBClientError,
  NBBNotFoundError,
} from "./errors";

const EXTRACTOR_NAME = "xbrl-chain-v1";
export const extractorName = (): string => EXTRACTOR_NAME;

export function ok<T>(body: T, init?: { status?: number }): NextResponse {
  return NextResponse.json(body, { status: init?.status ?? 200 });
}

export function fail(
  status: number,
  detail: unknown,
): NextResponse {
  return NextResponse.json({ detail }, { status });
}

/**
 * Map a thrown error to a Response. Keeps the route bodies short and
 * the wire format consistent. The frontend's ApiError class reads
 * `body.detail` for 4xx/5xx so this matches what it expects.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AmbiguousMatchError) {
    // 409 with structured candidates — frontend has a dedicated
    // AmbiguousMatchApiError that looks for this shape.
    return NextResponse.json(
      {
        detail: {
          code: "ambiguous_match",
          message: err.message,
          candidates: err.candidates,
        },
      },
      { status: 409 },
    );
  }
  if (err instanceof KBOScraperError) {
    // KBO returns "not found" via this — surface as 404 so the
    // frontend can render an empty state.
    return fail(404, err.message);
  }
  if (err instanceof NBBNotFoundError) {
    return fail(404, err.message);
  }
  if (err instanceof NBBClientError) {
    // 502 = upstream is the problem, not our request.
    return fail(502, err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[route handler] unexpected error:", err);
  return fail(500, message);
}
