/**
 * POST /api/companies/bulk
 *
 * Body: { queries: string[], refresh?: boolean }
 *
 * Resolve up to 100 queries in one call. Each query is independent —
 * a single bad query (404, ambiguous, network error) does not fail the
 * request; it becomes a result with the appropriate status. Concurrency
 * is capped to avoid hammering KBO / NBB / OpenAI.
 */

import type { NextRequest } from "next/server";

import { EnrichmentRepository } from "@/lib/server/db/repository";
import { tryNormalise } from "@/lib/server/enterpriseNumber";
import { AmbiguousMatchError, KBOScraperError } from "@/lib/server/errors";
import { extractorName, fail, ok } from "@/lib/server/http";
import { EnrichmentPipeline } from "@/lib/server/pipeline";
import type {
  CandidateMatch,
  CompanyFinancialReport,
} from "@/lib/server/models";

const BULK_CONCURRENCY = 5;
const MAX_QUERIES = 100;

type Result = {
  query: string;
  status: "ok" | "not_found" | "ambiguous" | "error";
  report: CompanyFinancialReport | null;
  candidates: CandidateMatch[] | null;
  from_cache: boolean;
  error: string | null;
};

/** Run an async function over each input with bounded concurrency. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: { queries?: unknown; refresh?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  if (!Array.isArray(body.queries) || body.queries.length === 0) {
    return fail(400, "queries must be a non-empty array.");
  }
  if (body.queries.length > MAX_QUERIES) {
    return fail(400, `Too many queries (max ${MAX_QUERIES}).`);
  }
  const queries = (body.queries as unknown[]).map((q) => String(q));
  const refresh = body.refresh === true;

  const repo = EnrichmentRepository.create();
  const pipeline = new EnrichmentPipeline();
  const started = performance.now();

  const results = await mapWithLimit(queries, BULK_CONCURRENCY, async (raw): Promise<Result> => {
    const query = raw.trim();
    if (!query) {
      return {
        query: raw,
        status: "error",
        report: null,
        candidates: null,
        from_cache: false,
        error: "empty query",
      };
    }

    const cbe = tryNormalise(query);

    // Cache fast path
    if (repo !== null && !refresh && cbe !== null) {
      try {
        const cached = await repo.getReport(cbe);
        if (cached && cached.statements.length > 0) {
          return {
            query,
            status: "ok",
            report: cached,
            candidates: null,
            from_cache: true,
            error: null,
          };
        }
      } catch (err) {
        console.warn(`Cache read failed for ${cbe}:`, err);
      }
    }

    let report: CompanyFinancialReport;
    try {
      report = await pipeline.run(query);
    } catch (err) {
      if (err instanceof AmbiguousMatchError) {
        return {
          query,
          status: "ambiguous",
          report: null,
          candidates: err.candidates,
          from_cache: false,
          error: null,
        };
      }
      if (err instanceof KBOScraperError) {
        return {
          query,
          status: "not_found",
          report: null,
          candidates: null,
          from_cache: false,
          error: err.message,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Pipeline failed for ${query}:`, err);
      return {
        query,
        status: "error",
        report: null,
        candidates: null,
        from_cache: false,
        error: msg,
      };
    }

    if (repo !== null) {
      try {
        await repo.saveReport(report, extractorName());
      } catch (err) {
        console.warn(
          `Failed to persist report for ${report.company.enterprise_number}:`,
          err,
        );
      }
    }

    return {
      query,
      status: "ok",
      report,
      candidates: null,
      from_cache: false,
      error: null,
    };
  });

  return ok({
    results,
    completed_at: new Date().toISOString(),
    elapsed_ms: Math.round((performance.now() - started) * 10) / 10,
  });
}
