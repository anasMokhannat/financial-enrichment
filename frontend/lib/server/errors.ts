/**
 * Server-side error taxonomy. Mirrors backend/src/exceptions.py.
 *
 * Route handlers map these to HTTP status codes — see lib/server/http.ts.
 */

export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}

export class NBBClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NBBClientError";
  }
}

/** NBB returned 404 — the entity isn't in CBSO. A legitimate "no data". */
export class NBBNotFoundError extends NBBClientError {
  constructor(message: string) {
    super(message);
    this.name = "NBBNotFoundError";
  }
}

export class KBOScraperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KBOScraperError";
  }
}

/** KBO returned multiple plausible matches for a free-text query. */
export class AmbiguousMatchError extends Error {
  readonly candidates: Array<{
    enterprise_number: string;
    name: string;
    address: string | null;
  }>;
  constructor(
    candidates: AmbiguousMatchError["candidates"],
    message = "Multiple companies match the query",
  ) {
    super(message);
    this.name = "AmbiguousMatchError";
    this.candidates = candidates;
  }
}

export class FinancialExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancialExtractionError";
  }
}
