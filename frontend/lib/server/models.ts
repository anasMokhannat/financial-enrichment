/**
 * Zod schemas + inferred TS types for the server-side data model.
 *
 * Ports backend/src/models.py 1:1 — when the schema changes, both
 * sides must be updated. The frontend's display types in
 * [lib/types.ts] mirror the same shapes for client consumption;
 * the difference is that these schemas can validate at runtime
 * (parse the NBB/Supabase responses) and the client types only
 * describe what crosses the JSON wire.
 *
 * Numeric financials are kept as `Decimal` (decimal.js) inside the
 * pipeline to avoid float drift on aggregations, and serialised to
 * string at the HTTP boundary so the frontend gets the same
 * `string | null` shape it already expects.
 */

import { z } from "zod";

// ── Enums ──────────────────────────────────────────────────────────────

export const FilingFormat = z.enum(["xbrl", "pdf", "unknown"]);
export type FilingFormat = z.infer<typeof FilingFormat>;

// ── Reused primitives ──────────────────────────────────────────────────

/**
 * ISO date (YYYY-MM-DD). We keep dates as strings end-to-end:
 * `Date` objects don't survive JSON.stringify cleanly and pulling
 * a Date class into Zod adds bidirectional parsing without buying
 * us anything the frontend needs.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateNullable = isoDate.nullable();

/**
 * Numeric financial value. Always serialised as `string | null` on the
 * HTTP wire to preserve precision and match the frontend's existing
 * display types (lib/types.ts), but we accept either string OR number
 * on input because of where the values come from:
 *
 *   - XBRL extractor → string (via toWireString)
 *   - Supabase numeric(20,2) reads → JS number (supabase-js parses
 *     Postgres numerics into Number by default)
 *   - JSON request bodies → could be either
 *
 * The transform coerces to string so every downstream consumer sees
 * the same shape regardless of where the data came from.
 */
const numericString = z
  .union([z.string(), z.number()])
  .nullable()
  .transform((v) => (v === null ? null : String(v)));

// ── KBO entities ───────────────────────────────────────────────────────

export const NaceCode = z.object({
  code: z.string().describe("Numeric code, e.g. '47.11' or '74.999'"),
  description: z.string().nullable(),
  source: z.string().nullable().describe("VAT, NSSO or EDRL"),
  version: z.number().int().nullable().describe("Nacebel version year"),
  since: isoDateNullable,
});
export type NaceCode = z.infer<typeof NaceCode>;

export const Func = z.object({
  role: z.string(),
  holder_name: z.string().nullable(),
  holder_enterprise_number: z.string().nullable(),
  since: isoDateNullable,
});
export type Func = z.infer<typeof Func>;

/**
 * A "corporate mandate" — another company sitting on this company's
 * board. Different shape from {@link Func}: the holder is a CBE, not
 * a person. Kept on a dedicated field so the directors-as-prospects
 * panel stays human-only while we still capture the graph edge for
 * group-structure mapping.
 */
export const CorporateMandate = z.object({
  role: z.string(),
  holder_enterprise_number: z.string(),
  /** Display name as it appears on KBO ("ACME HOLDING BV"). May be null
   *  if the row only had the CBE. */
  holder_name: z.string().nullable(),
  since: isoDateNullable,
});
export type CorporateMandate = z.infer<typeof CorporateMandate>;

/** ISO 3166-1 alpha-2 country code for the originating registry. */
export const Country = z.enum(["BE", "FR"]);
export type Country = z.infer<typeof Country>;

/** Data source for a filing or statement row. Belgium → NBB Central
 *  Balance Sheet Office; France → INPI Registre National des Entreprises. */
export const Provider = z.enum(["nbb", "inpi"]);
export type Provider = z.infer<typeof Provider>;

export const Company = z.object({
  /**
   * Belgium → 10-digit CBE/KBO/BCE number (no dots).
   * France  → 9-digit SIREN (no spaces).
   * The `country` discriminator below distinguishes the two.
   */
  enterprise_number: z.string(),
  /** ISO 3166-1 alpha-2 country code of the originating registry. */
  country: Country.default("BE"),
  name: z.string().nullable(),
  trade_name: z.string().nullable(),
  legal_form: z.string().nullable(),
  address: z.string().nullable(),
  status: z.string().nullable(),
  start_date: isoDateNullable,
  dissolution_date: isoDateNullable,
  vat_subject: z.boolean().nullable(),
  nace_codes: z.array(NaceCode).default([]),
  functions: z.array(Func).default([]),
  corporate_mandates: z.array(CorporateMandate).default([]),
});
export type Company = z.infer<typeof Company>;

// ── NBB filings ────────────────────────────────────────────────────────

export const FilingReference = z
  .object({
    reference: z.string(),
    deposit_date: isoDateNullable,
    exercise_start: isoDateNullable,
    exercise_end: isoDateNullable,
    model_type: z.string().nullable(),
    language: z.string().nullable(),
    accounting_format: FilingFormat.default("unknown"),
    /** Supabase Storage object path inside the `annual-accounts` bucket.
     *  Null until the PDF has been uploaded successfully. */
    storage_path: z.string().nullable().default(null),
    /** Where this filing reference originated. Belgian filings come
     *  from NBB; French ones from INPI. */
    provider: Provider.default("nbb"),
    // Derived from exercise_end. Supabase doesn't store it; the
    // pipeline output doesn't carry it. The transform below computes
    // it on parse so the frontend always sees it on the wire.
    fiscal_year: z.number().int().nullable().optional(),
  })
  .transform((data) => ({
    ...data,
    fiscal_year:
      data.fiscal_year ??
      (data.exercise_end ? Number(data.exercise_end.slice(0, 4)) : null),
  }));
export type FilingReference = z.infer<typeof FilingReference>;

export function fiscalYear(ref: FilingReference): number | null {
  return ref.fiscal_year;
}

// ── Financial statement ────────────────────────────────────────────────

/**
 * Normalised financial snapshot for a single filing. Values in EUR.
 * Missing fields are `null`, never zero, so callers can distinguish
 * "not reported" from "reported as zero".
 */
export const FinancialStatement = z.object({
  enterprise_number: z.string(),
  reference: z.string(),
  fiscal_year: z.number().int().nullable(),
  exercise_start: isoDateNullable,
  exercise_end: isoDateNullable,
  currency: z.string().default("EUR"),

  revenue: numericString,
  operating_profit: numericString,
  net_profit: numericString,

  total_assets: numericString,
  fixed_assets: numericString,
  current_assets: numericString,

  total_equity: numericString,
  total_liabilities: numericString,
  long_term_debt: numericString,
  short_term_debt: numericString,

  cash_and_equivalents: numericString,
  inventory: numericString,
  depreciation: numericString,
  employees_fte: numericString,

  source: FilingFormat.default("unknown"),
  /** Where this row's extracted figures came from. */
  provider: Provider.default("nbb"),
  raw_headings: z.record(z.string(), z.string()).default({}),
});
export type FinancialStatement = z.infer<typeof FinancialStatement>;

// ── Composite responses ────────────────────────────────────────────────

export const CompanyFinancialReport = z.object({
  company: Company,
  filings: z.array(FilingReference),
  statements: z.array(FinancialStatement),
});
export type CompanyFinancialReport = z.infer<typeof CompanyFinancialReport>;

export const CandidateMatch = z.object({
  enterprise_number: z.string(),
  name: z.string(),
  address: z.string().nullable(),
});
export type CandidateMatch = z.infer<typeof CandidateMatch>;

// ── Commercial analysis ────────────────────────────────────────────────

export const Verdict = z.enum(["strong", "stable", "watch", "risky", "avoid"]);
export type Verdict = z.infer<typeof Verdict>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

/**
 * How well the target company fits the user's stated ICP. Independent
 * of {@link Verdict} — verdict is the financial-health read; ICP fit is
 * the commercial-direction read. Both are surfaced side by side.
 */
export const IcpFit = z.enum([
  "strong_fit",
  "partial_fit",
  "weak_fit",
  "no_fit",
  "unknown",
]);
export type IcpFit = z.infer<typeof IcpFit>;

export const CommercialAnalysis = z.object({
  enterprise_number: z.string(),
  verdict: Verdict,
  summary: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  commercial_recommendation: z.string(),
  confidence: Confidence,
  /** Numeric confidence 0-100 set by the analyzer. */
  confidence_score: z.number().int().min(0).max(100).nullable(),
  /** Short bullet phrases explaining the confidence level. */
  confidence_factors: z.array(z.string()).default([]),
  /** ICP fit derived from the user's profile. "unknown" when no profile
   *  is set — the analyzer falls back to financial-only judgement. */
  icp_fit: IcpFit.default("unknown"),
  /** 2-4 short reasons explaining the ICP fit decision. */
  icp_fit_reasons: z.array(z.string()).default([]),
  /** One or two sentences summarising how to angle a prospecting email
   *  to people inside this company, given the financial picture. */
  outreach_summary: z.string().default(""),
  /** 3-5 short, ready-to-use email hooks that reference actual numbers
   *  from the statements (revenue growth, headcount, cash position…). */
  outreach_email_angles: z.array(z.string()).default([]),
  based_on_filing_refs: z.array(z.string()),
  model: z.string().nullable(),
  generated_at: z.string().nullable(),
});
export type CommercialAnalysis = z.infer<typeof CommercialAnalysis>;

// ── App profile (user's own company + ICP) ─────────────────────────────

/**
 * The user-of-this-app's own company info plus their ICP. Single row
 * for v1 (no auth); the analyzer reads this and biases its output
 * toward what *this user* cares about. Free-text fields throughout so
 * the LLM can reason flexibly instead of forcing rigid filters.
 */
export const AppProfile = z.object({
  company_name: z.string().default(""),
  company_one_liner: z.string().default(""),
  offering: z.string().default(""),
  geo_focus: z.string().default(""),
  icp_description: z.string().default(""),
  icp_target_industries: z.string().default(""),
  icp_target_size: z.string().default(""),
  icp_disqualifiers: z.string().default(""),
  updated_at: z.string().nullable().default(null),
});
export type AppProfile = z.infer<typeof AppProfile>;

export function isProfileBlank(p: AppProfile | null | undefined): boolean {
  if (!p) return true;
  return (
    !p.company_name.trim() &&
    !p.company_one_liner.trim() &&
    !p.offering.trim() &&
    !p.icp_description.trim() &&
    !p.icp_target_industries.trim() &&
    !p.icp_target_size.trim() &&
    !p.icp_disqualifiers.trim()
  );
}
