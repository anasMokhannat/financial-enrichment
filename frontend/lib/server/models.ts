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

export const Company = z.object({
  enterprise_number: z.string().describe("10-digit BCE/KBO/CBE number, no dots"),
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
});
export type Company = z.infer<typeof Company>;

// ── NBB filings ────────────────────────────────────────────────────────

export const FilingReference = z.object({
  reference: z.string(),
  deposit_date: isoDateNullable,
  exercise_start: isoDateNullable,
  exercise_end: isoDateNullable,
  model_type: z.string().nullable(),
  language: z.string().nullable(),
  accounting_format: FilingFormat.default("unknown"),
});
export type FilingReference = z.infer<typeof FilingReference>;

export function fiscalYear(ref: FilingReference): number | null {
  return ref.exercise_end ? Number(ref.exercise_end.slice(0, 4)) : null;
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
  based_on_filing_refs: z.array(z.string()),
  model: z.string().nullable(),
  generated_at: z.string().nullable(),
});
export type CommercialAnalysis = z.infer<typeof CommercialAnalysis>;
