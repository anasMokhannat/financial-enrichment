-- ============================================================================
-- INPI / France support.
--
-- Adds:
--   - `country`   on companies            ('BE' for Belgian KBO/NBB entries,
--                                          'FR' for French INPI entries).
--   - `provider`  on filing_references    ('nbb' or 'inpi') — where the
--                                          PDF + reference came from.
--   - `provider`  on financial_statements ('nbb' or 'inpi') — where the
--                                          extracted figures came from.
--
-- All default to the Belgian existing-data values so legacy rows stay valid.
-- The score / display layer doesn't read these directly; they're for audit,
-- filtering, and future per-country pipelines.
-- ============================================================================

ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'BE';

ALTER TABLE public.filing_references
    ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'nbb';

ALTER TABLE public.financial_statements
    ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'nbb';

-- Index for "show me my French companies" type filters in the listing
-- and group-graph endpoints. Cheap on Postgres so we add it unconditionally.
CREATE INDEX IF NOT EXISTS idx_companies_country
    ON public.companies (country);
