-- ============================================================================
-- legal-financial-enrichment · full Supabase bootstrap
-- ============================================================================
--
-- Single-file consolidation of every migration under ./migrations. Apply this
-- ONCE on a fresh Supabase project to bring it to the current schema; on a
-- project that already has earlier migrations, run the per-file migrations
-- in order instead (they are idempotent).
--
-- Tables
--   · companies               — one row per Belgian enterprise number
--   · nace_codes              — NACE classifications per company
--   · functions               — directors / managers / auditors
--   · filing_references       — every annual filing reference from NBB
--   · financial_statements    — extracted financials per filing
--   · commercial_analyses     — cached LLM commercial-fit assessments
--
-- RLS strategy
--   Read-anyone, write-service-role-only. Data is public reference data
--   that anyone could already look up on KBO/NBB; we just cache it. The
--   Next.js Route Handlers use the service-role key (bypasses RLS) for
--   writes; any future browser-direct reads would use the anon key
--   (SELECT only).
-- ============================================================================


-- ── companies ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.companies (
    enterprise_number   text PRIMARY KEY
        CHECK (enterprise_number ~ '^[01][0-9]{9}$'),
    name                text,
    trade_name          text,
    legal_form          text,
    address             text,
    status              text,
    start_date          date,
    dissolution_date    date,
    vat_subject         boolean,

    first_seen_at       timestamptz NOT NULL DEFAULT now(),
    last_refreshed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS companies_name_idx
    ON public.companies USING gin (to_tsvector('simple', coalesce(name, '')));

CREATE INDEX IF NOT EXISTS companies_last_refreshed_idx
    ON public.companies (last_refreshed_at DESC);


-- ── nace_codes ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nace_codes (
    id                  bigserial PRIMARY KEY,
    enterprise_number   text NOT NULL
        REFERENCES public.companies(enterprise_number) ON DELETE CASCADE,
    code                text NOT NULL,
    description         text,
    source              text,                 -- VAT / NSSO / EDRL
    version             integer,              -- Nacebel version year
    since               date,
    UNIQUE (enterprise_number, code, source, version)
);

CREATE INDEX IF NOT EXISTS nace_codes_company_idx
    ON public.nace_codes (enterprise_number);
CREATE INDEX IF NOT EXISTS nace_codes_code_idx
    ON public.nace_codes (code);


-- ── functions ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.functions (
    id                          bigserial PRIMARY KEY,
    enterprise_number           text NOT NULL
        REFERENCES public.companies(enterprise_number) ON DELETE CASCADE,
    role                        text NOT NULL,
    holder_name                 text,
    holder_enterprise_number    text,
    since                       date
);

CREATE INDEX IF NOT EXISTS functions_company_idx
    ON public.functions (enterprise_number);


-- ── filing_references ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.filing_references (
    reference           text PRIMARY KEY,
    enterprise_number   text NOT NULL
        REFERENCES public.companies(enterprise_number) ON DELETE CASCADE,
    deposit_date        date,
    exercise_start      date,
    exercise_end        date,
    model_type          text,
    language            text,
    accounting_format   text                  -- 'xbrl' / 'pdf' / 'unknown'
        CHECK (accounting_format IS NULL
               OR accounting_format IN ('xbrl', 'pdf', 'unknown')),
    fetched_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS filings_company_idx
    ON public.filing_references (enterprise_number);
CREATE INDEX IF NOT EXISTS filings_exercise_end_idx
    ON public.filing_references (enterprise_number, exercise_end DESC);


-- ── financial_statements ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.financial_statements (
    reference               text PRIMARY KEY
        REFERENCES public.filing_references(reference) ON DELETE CASCADE,
    enterprise_number       text NOT NULL
        REFERENCES public.companies(enterprise_number) ON DELETE CASCADE,
    fiscal_year             integer,
    exercise_start          date,
    exercise_end            date,
    currency                text NOT NULL DEFAULT 'EUR',

    revenue                 numeric(20, 2),
    operating_profit        numeric(20, 2),
    net_profit              numeric(20, 2),
    total_assets            numeric(20, 2),
    fixed_assets            numeric(20, 2),
    current_assets          numeric(20, 2),
    total_equity            numeric(20, 2),
    total_liabilities       numeric(20, 2),
    long_term_debt          numeric(20, 2),
    short_term_debt         numeric(20, 2),
    cash_and_equivalents    numeric(20, 2),
    inventory               numeric(20, 2),
    depreciation            numeric(20, 2),
    employees_fte           numeric(10, 2),

    source                  text
        CHECK (source IS NULL OR source IN ('xbrl', 'pdf', 'unknown')),
    extractor               text,               -- e.g. 'xbrl-chain-v1'
    raw_headings            jsonb NOT NULL DEFAULT '{}'::jsonb,

    extracted_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS statements_company_year_idx
    ON public.financial_statements (enterprise_number, fiscal_year DESC);


-- ── commercial_analyses ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.commercial_analyses (
    enterprise_number          text PRIMARY KEY
        REFERENCES public.companies(enterprise_number) ON DELETE CASCADE,

    verdict                    text NOT NULL
        CHECK (verdict IN ('strong', 'stable', 'watch', 'risky', 'avoid')),
    summary                    text NOT NULL,
    strengths                  jsonb NOT NULL DEFAULT '[]'::jsonb,
    concerns                   jsonb NOT NULL DEFAULT '[]'::jsonb,
    commercial_recommendation  text NOT NULL,
    confidence                 text NOT NULL
        CHECK (confidence IN ('high', 'medium', 'low')),

    -- Numeric companion to the categorical `confidence`. Nullable so
    -- pre-existing rows (generated before this column was added) keep
    -- working until they're regenerated.
    confidence_score           integer
        CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
    confidence_factors         jsonb NOT NULL DEFAULT '[]'::jsonb,

    based_on_filing_refs       text[] NOT NULL DEFAULT '{}',
    model                      text,
    generated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commercial_analyses_generated_idx
    ON public.commercial_analyses (generated_at DESC);


-- ── RLS: read-anyone, write-service-role-only ────────────────────────────────

ALTER TABLE public.companies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nace_codes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.functions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filing_references    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_analyses  ENABLE ROW LEVEL SECURITY;

-- DROP POLICY IF EXISTS keeps the bootstrap idempotent — running this
-- file twice on the same project is a no-op.
DROP POLICY IF EXISTS companies_read_all            ON public.companies;
DROP POLICY IF EXISTS nace_codes_read_all           ON public.nace_codes;
DROP POLICY IF EXISTS functions_read_all            ON public.functions;
DROP POLICY IF EXISTS filings_read_all              ON public.filing_references;
DROP POLICY IF EXISTS statements_read_all           ON public.financial_statements;
DROP POLICY IF EXISTS commercial_analyses_read_all  ON public.commercial_analyses;

CREATE POLICY companies_read_all
    ON public.companies FOR SELECT USING (true);
CREATE POLICY nace_codes_read_all
    ON public.nace_codes FOR SELECT USING (true);
CREATE POLICY functions_read_all
    ON public.functions FOR SELECT USING (true);
CREATE POLICY filings_read_all
    ON public.filing_references FOR SELECT USING (true);
CREATE POLICY statements_read_all
    ON public.financial_statements FOR SELECT USING (true);
CREATE POLICY commercial_analyses_read_all
    ON public.commercial_analyses FOR SELECT USING (true);


-- ── Audit-column auto-update ─────────────────────────────────────────────────
--
-- `companies.last_refreshed_at` should bump on every upsert that actually
-- changes a row. The repository sets it explicitly on save, but a trigger is
-- belt-and-braces for any future direct writes.

CREATE OR REPLACE FUNCTION public.touch_last_refreshed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.last_refreshed_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_touch_last_refreshed ON public.companies;
CREATE TRIGGER companies_touch_last_refreshed
    BEFORE UPDATE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.touch_last_refreshed_at();
