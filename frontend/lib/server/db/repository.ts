/**
 * Supabase repositories.
 *
 * Ports backend/src/db/enrichment_repo.py and analysis_repo.py to a
 * single module — both share one Supabase client. Service-role key is
 * used (RLS-bypassing) since this runs server-side in Next.js Route
 * Handlers, the same trust boundary the Python backend operated under.
 *
 * The client is lazy + memoised: building it at import time would
 * crash the lambda on cold-start if the env vars are missing, but we
 * want `/api/health` to still report `supabase: false` cleanly.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env, hasSupabase } from "../config";
import {
  CommercialAnalysis,
  Company,
  CompanyFinancialReport,
  FilingReference,
  FinancialStatement,
  type Func,
  type NaceCode,
} from "../models";

let cachedClient: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (cachedClient) return cachedClient;
  if (!hasSupabase()) {
    throw new Error(
      "Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).",
    );
  }
  cachedClient = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/**
 * Strip undefined / null values from a row so partial upserts don't
 * overwrite existing columns with NULL. Mirrors Python's
 * `model_dump(exclude_none=True)` semantics.
 */
function stripNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ── EnrichmentRepository ────────────────────────────────────────────────

export class EnrichmentRepository {
  /** Returns null when Supabase isn't configured. */
  static create(): EnrichmentRepository | null {
    if (!hasSupabase()) return null;
    return new EnrichmentRepository();
  }

  // ── Writes ────────────────────────────────────────────────────────────

  async upsertCompany(company: Company): Promise<void> {
    const { nace_codes: _n, functions: _f, ...rest } = company;
    const row = stripNulls(rest);
    const { error } = await client()
      .from("companies")
      .upsert(row, { onConflict: "enterprise_number" });
    if (error) throw new Error(`upsertCompany: ${error.message}`);
  }

  async replaceNaceCodes(
    enterpriseNumber: string,
    codes: NaceCode[],
  ): Promise<void> {
    const { error: delErr } = await client()
      .from("nace_codes")
      .delete()
      .eq("enterprise_number", enterpriseNumber);
    if (delErr) throw new Error(`replaceNaceCodes delete: ${delErr.message}`);
    if (codes.length === 0) return;

    // The unique key on this table is (enterprise_number, code, source,
    // version). KBO sometimes lists the same NACE entry twice (active
    // row + historical row with identical code/source/version), which
    // would violate the constraint within a single insert. Dedupe by
    // the constraint tuple, keeping the first occurrence — KBO renders
    // the current entry first, so that's the one we want.
    const seen = new Set<string>();
    const deduped: NaceCode[] = [];
    for (const c of codes) {
      const key = `${c.code}|${c.source ?? ""}|${c.version ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(c);
    }

    const rows = deduped.map((c) => ({
      ...stripNulls(c),
      enterprise_number: enterpriseNumber,
    }));
    const { error } = await client().from("nace_codes").insert(rows);
    if (error) throw new Error(`replaceNaceCodes insert: ${error.message}`);
  }

  async replaceFunctions(
    enterpriseNumber: string,
    functions: Func[],
  ): Promise<void> {
    const { error: delErr } = await client()
      .from("functions")
      .delete()
      .eq("enterprise_number", enterpriseNumber);
    if (delErr) throw new Error(`replaceFunctions delete: ${delErr.message}`);
    if (functions.length === 0) return;
    const rows = functions.map((f) => ({
      ...stripNulls(f),
      enterprise_number: enterpriseNumber,
    }));
    const { error } = await client().from("functions").insert(rows);
    if (error) throw new Error(`replaceFunctions insert: ${error.message}`);
  }

  async upsertFilingReferences(
    enterpriseNumber: string,
    refs: FilingReference[],
  ): Promise<void> {
    if (refs.length === 0) return;
    const rows = refs.map((r) => {
      // `fiscal_year` is derived from `exercise_end` by the Zod
      // transform (see models.ts); it's not a column on the table.
      // Strip it before upsert so PostgREST doesn't reject the row.
      const { fiscal_year: _fy, ...persisted } = r;
      return {
        ...stripNulls(persisted),
        enterprise_number: enterpriseNumber,
      };
    });
    const { error } = await client()
      .from("filing_references")
      .upsert(rows, { onConflict: "reference" });
    if (error) throw new Error(`upsertFilingReferences: ${error.message}`);
  }

  async upsertFinancialStatement(
    statement: FinancialStatement,
    extractor: string,
  ): Promise<void> {
    // Statements use exclude_none=False semantics in Python — keep nulls
    // so revising a filing can clear a previously-extracted value.
    const row = { ...statement, extractor };
    const { error } = await client()
      .from("financial_statements")
      .upsert(row, { onConflict: "reference" });
    if (error) throw new Error(`upsertFinancialStatement: ${error.message}`);
  }

  /**
   * Persist a full report. Order matters because of FKs:
   *   company → (nace, functions, filings) → statements (FK to filings).
   */
  async saveReport(
    report: CompanyFinancialReport,
    extractor: string,
  ): Promise<void> {
    await this.upsertCompany(report.company);
    await this.replaceNaceCodes(
      report.company.enterprise_number,
      report.company.nace_codes,
    );
    await this.replaceFunctions(
      report.company.enterprise_number,
      report.company.functions,
    );
    await this.upsertFilingReferences(
      report.company.enterprise_number,
      report.filings,
    );
    for (const s of report.statements) {
      await this.upsertFinancialStatement(s, extractor);
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────────

  async getCompany(enterpriseNumber: string): Promise<Company | null> {
    const { data, error } = await client()
      .from("companies")
      .select("*, nace_codes(*), functions(*)")
      .eq("enterprise_number", enterpriseNumber)
      .maybeSingle();
    if (error) throw new Error(`getCompany: ${error.message}`);
    if (!data) return null;
    // Pluck embedded relations and strip audit columns the model doesn't carry.
    const { nace_codes, functions, first_seen_at: _a, last_refreshed_at: _b, ...rest } =
      data as Record<string, unknown>;
    return Company.parse({
      ...rest,
      nace_codes: nace_codes ?? [],
      functions: functions ?? [],
    });
  }

  async getFilings(enterpriseNumber: string): Promise<FilingReference[]> {
    const { data, error } = await client()
      .from("filing_references")
      .select("*")
      .eq("enterprise_number", enterpriseNumber)
      .order("exercise_end", { ascending: false });
    if (error) throw new Error(`getFilings: ${error.message}`);
    return (data ?? []).map((r) => {
      const { enterprise_number: _e, fetched_at: _f, ...rest } = r as Record<
        string,
        unknown
      >;
      return FilingReference.parse(rest);
    });
  }

  async getStatements(enterpriseNumber: string): Promise<FinancialStatement[]> {
    const { data, error } = await client()
      .from("financial_statements")
      .select("*")
      .eq("enterprise_number", enterpriseNumber)
      .order("fiscal_year", { ascending: false });
    if (error) throw new Error(`getStatements: ${error.message}`);
    return (data ?? []).map((r) => {
      const { extractor: _x, extracted_at: _y, ...rest } = r as Record<
        string,
        unknown
      >;
      return FinancialStatement.parse(rest);
    });
  }

  async getReport(
    enterpriseNumber: string,
  ): Promise<CompanyFinancialReport | null> {
    const company = await this.getCompany(enterpriseNumber);
    if (company === null) return null;
    const [filings, statements] = await Promise.all([
      this.getFilings(enterpriseNumber),
      this.getStatements(enterpriseNumber),
    ]);
    return { company, filings, statements };
  }

  // ── List / stats ──────────────────────────────────────────────────────

  async listCompanies(opts: {
    limit?: number;
    offset?: number;
  }): Promise<{ rows: CompanyListRow[]; total: number }> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const { data, error, count } = await client()
      .from("companies")
      .select(
        "enterprise_number,name,trade_name,legal_form,status,dissolution_date,last_refreshed_at",
        { count: "exact" },
      )
      .order("last_refreshed_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(`listCompanies: ${error.message}`);
    return {
      rows: (data ?? []) as CompanyListRow[],
      total: count ?? (data?.length ?? 0),
    };
  }

  async countCompanies(): Promise<number> {
    const { count, error } = await client()
      .from("companies")
      .select("enterprise_number", { count: "exact", head: true });
    if (error) throw new Error(`countCompanies: ${error.message}`);
    return count ?? 0;
  }

  async countStatements(): Promise<number> {
    const { count, error } = await client()
      .from("financial_statements")
      .select("reference", { count: "exact", head: true });
    if (error) throw new Error(`countStatements: ${error.message}`);
    return count ?? 0;
  }

  async latestExtractionAt(): Promise<string | null> {
    const { data, error } = await client()
      .from("financial_statements")
      .select("extracted_at")
      .order("extracted_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`latestExtractionAt: ${error.message}`);
    const row = data?.[0] as { extracted_at?: string } | undefined;
    return row?.extracted_at ?? null;
  }

  /**
   * PostgREST has no GROUP BY in the URL DSL, so we fetch the rows and
   * count in JS. Cheap as long as the page size stays small — 50 rows
   * means a few hundred references at most.
   */
  async statementCountsByEnterprise(
    enterpriseNumbers: string[],
  ): Promise<Record<string, number>> {
    if (enterpriseNumbers.length === 0) return {};
    const { data, error } = await client()
      .from("financial_statements")
      .select("enterprise_number")
      .in("enterprise_number", enterpriseNumbers);
    if (error) throw new Error(`statementCountsByEnterprise: ${error.message}`);
    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const cbe = (row as { enterprise_number: string }).enterprise_number;
      counts[cbe] = (counts[cbe] ?? 0) + 1;
    }
    return counts;
  }
}

export type CompanyListRow = {
  enterprise_number: string;
  name: string | null;
  trade_name: string | null;
  legal_form: string | null;
  status: string | null;
  dissolution_date: string | null;
  last_refreshed_at: string | null;
};

// ── AnalysisRepository ──────────────────────────────────────────────────

export class AnalysisRepository {
  static create(): AnalysisRepository | null {
    if (!hasSupabase()) return null;
    return new AnalysisRepository();
  }

  async upsert(analysis: CommercialAnalysis): Promise<void> {
    const row = stripNulls(analysis);
    const { error } = await client()
      .from("commercial_analyses")
      .upsert(row, { onConflict: "enterprise_number" });
    if (error) throw new Error(`AnalysisRepository.upsert: ${error.message}`);
  }

  async get(enterpriseNumber: string): Promise<CommercialAnalysis | null> {
    const { data, error } = await client()
      .from("commercial_analyses")
      .select("*")
      .eq("enterprise_number", enterpriseNumber)
      .maybeSingle();
    if (error) throw new Error(`AnalysisRepository.get: ${error.message}`);
    if (!data) return null;
    return CommercialAnalysis.parse(data);
  }
}
