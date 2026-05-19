-- ============================================================================
-- legal-financial-enrichment · initial schema
-- ============================================================================
--
-- Reference data we pull from KBO and NBB:
--   · companies               — one row per Belgian enterprise number
--   · nace_codes              — NACE classifications per company
--   · functions               — directors / managers / auditors
--   · filing_references       — every annual filing reference from NBB
--   · financial_statements    — extracted financials per filing
--
-- RLS strategy
-- ------------
-- Read-anyone, write-service-role-only. The data is public reference
-- data the world can already look up on KBO/NBB; we just cache it.
-- The backend uses the service-role key (bypasses RLS); the frontend
-- uses the anon key (RLS applies — SELECT only).
-- ============================================================================


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


CREATE TABLE IF NOT EXISTS public.financial_statements (
    -- One statement per filing reference. We use the reference as the
    -- primary key (rather than a synthetic id) so re-ingesting the same
    -- filing is a no-op via INSERT ... ON CONFLICT DO UPDATE.
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

    source                  text                -- which filing format
        CHECK (source IS NULL OR source IN ('xbrl', 'pdf', 'unknown')),
    extractor               text,               -- 'regex' / 'llm-gpt-4o-mini' / etc.
    raw_headings            jsonb NOT NULL DEFAULT '{}'::jsonb,

    extracted_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS statements_company_year_idx
    ON public.financial_statements (enterprise_number, fiscal_year DESC);


-- ──────────────────────────────────────────────────────────────────────────
-- Row-Level Security: read-anyone, write-service-role-only
-- ──────────────────────────────────────────────────────────────────────────
--
-- The service role bypasses RLS entirely, so the backend ingestion path
-- works without explicit INSERT/UPDATE/DELETE policies. The anon role
-- can only SELECT.

ALTER TABLE public.companies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nace_codes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.functions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filing_references    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_statements ENABLE ROW LEVEL SECURITY;

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
