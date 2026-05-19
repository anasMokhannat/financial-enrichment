/**
 * Thin fetch wrapper around the FastAPI backend.
 *
 * - Reads NEXT_PUBLIC_API_URL at build time. Server components and
 *   client components both work — the base URL is public.
 * - Throws `ApiError` on non-2xx so callers can switch on the status.
 *   Importantly, 409 surfaces `AmbiguousMatchError` so the search UI
 *   can render the candidates as a dropdown.
 */

import type {
  AmbiguousMatchError,
  BulkSearchResponse,
  CommercialAnalysis,
  CompanyFinancialReport,
  CompanyListResponse,
  CompanySearchResponse,
  HealthResponse,
  StatsResponse,
} from "./types";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Build the full URL for an API call.
 *
 * In the browser, `API_URL` can be relative (`/_/backend`) and the
 * browser resolves it against the current origin. In Node — which is
 * where Next.js runs Server Components and Route Handlers — `fetch`
 * rejects relative URLs with `ERR_INVALID_URL`. So when we're not in
 * the browser, prepend an absolute origin:
 *
 * - `VERCEL_URL` is set automatically on every Vercel deployment to
 *   the deployment's hostname (no protocol). On preview deploys it
 *   resolves to the preview URL, which is exactly what we want.
 * - Falls back to `http://localhost:3000` for `next dev`.
 *
 * If `API_URL` is already absolute (starts with `http`), it's used
 * as-is on both sides.
 */
function resolveUrl(path: string): string {
  if (API_URL.startsWith("http")) {
    return `${API_URL}${path}`;
  }
  if (typeof window !== "undefined") {
    return `${API_URL}${path}`;
  }
  const host = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";
  return `${host}${API_URL}${path}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API ${status}`);
    this.status = status;
    this.body = body;
  }
}

export class AmbiguousMatchApiError extends ApiError {
  readonly candidates: AmbiguousMatchError["candidates"];
  constructor(detail: AmbiguousMatchError) {
    super(409, detail, detail.message);
    this.candidates = detail.candidates;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(resolveUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  // Read the body ONCE as text, then try to JSON-parse in memory. Reading
  // a fetch Response twice — even on a different method — throws "Body has
  // already been read" because the underlying ReadableStream is consumed
  // on first read.
  const rawText = await res.text();
  let body: unknown = rawText;
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      // Non-JSON response (e.g. HTML from a proxy on 502). Keep the raw
      // text so the caller can still see it via ApiError.body.
    }
  }

  if (res.ok) {
    return body as T;
  }

  if (
    res.status === 409 &&
    body &&
    typeof body === "object" &&
    "detail" in (body as Record<string, unknown>) &&
    typeof (body as { detail: unknown }).detail === "object"
  ) {
    const detail = (body as { detail: AmbiguousMatchError }).detail;
    if (detail.code === "ambiguous_match") {
      throw new AmbiguousMatchApiError(detail);
    }
  }
  throw new ApiError(res.status, body);
}

export const api = {
  health(): Promise<HealthResponse> {
    return request<HealthResponse>("/health");
  },

  /** Resolve a name or CBE to a CompanyFinancialReport. */
  search(
    q: string,
    opts?: { refresh?: boolean; filings?: number }
  ): Promise<CompanySearchResponse> {
    const params = new URLSearchParams({ q });
    if (opts?.refresh) params.set("refresh", "true");
    if (opts?.filings !== undefined) params.set("filings", String(opts.filings));
    return request<CompanySearchResponse>(`/companies/search?${params}`);
  },

  /** Fetch a company by CBE (validated server-side). */
  getCompany(
    cbe: string,
    opts?: { refresh?: boolean; filings?: number }
  ): Promise<CompanyFinancialReport> {
    const params = new URLSearchParams();
    if (opts?.refresh) params.set("refresh", "true");
    if (opts?.filings !== undefined) params.set("filings", String(opts.filings));
    const qs = params.toString();
    return request<CompanyFinancialReport>(
      `/companies/${cbe}${qs ? `?${qs}` : ""}`
    );
  },

  /** Force a fresh pipeline run + DB update. */
  refreshCompany(
    cbe: string,
    opts?: { filings?: number }
  ): Promise<CompanyFinancialReport> {
    const params = new URLSearchParams();
    if (opts?.filings !== undefined) params.set("filings", String(opts.filings));
    const qs = params.toString();
    return request<CompanyFinancialReport>(
      `/companies/${cbe}/refresh${qs ? `?${qs}` : ""}`,
      { method: "POST" }
    );
  },

  /** Resolve up to 100 queries in one call. */
  bulkSearch(
    queries: string[],
    opts?: { refresh?: boolean }
  ): Promise<BulkSearchResponse> {
    return request<BulkSearchResponse>("/companies/bulk", {
      method: "POST",
      body: JSON.stringify({ queries, refresh: opts?.refresh ?? false }),
    });
  },

  /** Paginated list of every company in Supabase. */
  listCompanies(opts?: {
    limit?: number;
    offset?: number;
  }): Promise<CompanyListResponse> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return request<CompanyListResponse>(
      `/companies${qs ? `?${qs}` : ""}`
    );
  },

  /** Aggregate counts powering the Overview tiles. */
  stats(): Promise<StatsResponse> {
    return request<StatsResponse>("/stats");
  },

  /** Cached commercial-fit analysis for a company. 404 when not yet generated. */
  getAnalysis(cbe: string): Promise<CommercialAnalysis> {
    return request<CommercialAnalysis>(`/companies/${cbe}/analysis`);
  },

  /** Generate a fresh commercial-fit analysis, cache it, return it. */
  generateAnalysis(cbe: string): Promise<CommercialAnalysis> {
    return request<CommercialAnalysis>(`/companies/${cbe}/analyze`, {
      method: "POST",
    });
  },
};
