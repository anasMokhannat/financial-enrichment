/**
 * TypeScript shapes mirroring backend/src/models.py + src/api/schemas.py.
 * Hand-written rather than generated so the diff with the Python side is
 * intentional; when the backend schema changes, update these by hand.
 *
 * Numeric financial fields are typed as `string | null` because Pydantic
 * serialises Decimal to a JSON string to preserve precision. Convert to
 * number at the rendering boundary with Number(value).
 */

export type FilingFormat = "xbrl" | "pdf" | "unknown";

export type NaceCode = {
  code: string;
  description: string | null;
  source: string | null; // VAT / NSSO / EDRL
  version: number | null; // Nacebel version year
  since: string | null; // ISO date
};

export type Function = {
  role: string;
  holder_name: string | null;
  holder_enterprise_number: string | null;
  since: string | null;
};

export type Company = {
  enterprise_number: string;
  name: string | null;
  trade_name: string | null;
  legal_form: string | null;
  address: string | null;
  status: string | null;
  start_date: string | null;
  dissolution_date: string | null;
  vat_subject: boolean | null;
  nace_codes: NaceCode[];
  functions: Function[];
};

export type FilingReference = {
  reference: string;
  deposit_date: string | null;
  exercise_start: string | null;
  exercise_end: string | null;
  model_type: string | null;
  language: string | null;
  accounting_format: FilingFormat;
  fiscal_year: number | null;
};

export type FinancialStatement = {
  enterprise_number: string;
  reference: string;
  fiscal_year: number | null;
  exercise_start: string | null;
  exercise_end: string | null;
  currency: string;

  revenue: string | null;
  operating_profit: string | null;
  net_profit: string | null;
  total_assets: string | null;
  fixed_assets: string | null;
  current_assets: string | null;
  total_equity: string | null;
  total_liabilities: string | null;
  long_term_debt: string | null;
  short_term_debt: string | null;
  cash_and_equivalents: string | null;
  inventory: string | null;
  depreciation: string | null;
  employees_fte: string | null;

  source: FilingFormat;
  raw_headings: Record<string, string>;
};

export type CompanyFinancialReport = {
  company: Company;
  filings: FilingReference[];
  statements: FinancialStatement[];
};

export type CandidateMatch = {
  enterprise_number: string;
  name: string;
  address: string | null;
};

export type CompanySearchResponse = {
  query: string;
  report: CompanyFinancialReport | null;
  candidates: CandidateMatch[] | null;
  from_cache: boolean;
};

export type AmbiguousMatchError = {
  code: "ambiguous_match";
  message: string;
  candidates: CandidateMatch[];
};

export type BulkSearchResult = {
  query: string;
  status: "ok" | "not_found" | "ambiguous" | "error";
  report: CompanyFinancialReport | null;
  candidates: CandidateMatch[] | null;
  from_cache: boolean;
  error: string | null;
};

export type BulkSearchResponse = {
  results: BulkSearchResult[];
  completed_at: string;
  elapsed_ms: number;
};

export type HealthResponse = {
  status: "ok";
  services: {
    nbb: boolean;
    openai: boolean;
    supabase: boolean;
  };
};

export type CompanyListItem = {
  enterprise_number: string;
  name: string | null;
  trade_name: string | null;
  legal_form: string | null;
  status: string | null;
  dissolution_date: string | null;
  last_refreshed_at: string | null;
  statement_count: number;
};

export type CompanyListResponse = {
  items: CompanyListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type StatsResponse = {
  companies_cached: number;
  filings_extracted: number;
  last_extraction_at: string | null;
};

export type Verdict = "strong" | "stable" | "watch" | "risky" | "avoid";
export type Confidence = "high" | "medium" | "low";

export type CommercialAnalysis = {
  enterprise_number: string;
  verdict: Verdict;
  summary: string;
  strengths: string[];
  concerns: string[];
  commercial_recommendation: string;
  confidence: Confidence;
  /** Numeric confidence 0-100 set by the analyzer. Null on analyses
   *  generated before this field existed in the schema. */
  confidence_score: number | null;
  /** Short bullet phrases explaining the confidence level. */
  confidence_factors: string[];
  based_on_filing_refs: string[];
  model: string | null;
  generated_at: string | null;
};
