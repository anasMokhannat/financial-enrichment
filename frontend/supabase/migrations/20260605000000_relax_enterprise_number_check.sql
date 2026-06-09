-- ============================================================================
-- Relax companies.enterprise_number CHECK so it accepts both:
--   - Belgian CBE/KBO: 10 digits starting with 0 or 1
--   - French SIREN:    9 digits (any leading digit)
--
-- The original constraint (`^[01][0-9]{9}$`) was BE-only and rejects
-- every SIREN, so French companies can't be persisted until this is
-- relaxed. The two patterns don't overlap (10 vs 9 digits), so the
-- combined regex stays unambiguous.
-- ============================================================================

ALTER TABLE public.companies
    DROP CONSTRAINT IF EXISTS companies_enterprise_number_check;

ALTER TABLE public.companies
    ADD CONSTRAINT companies_enterprise_number_check
    CHECK (
        enterprise_number ~ '^[01][0-9]{9}$' -- Belgian CBE (10 digits, leading 0/1)
        OR enterprise_number ~ '^[0-9]{9}$'   -- French SIREN (9 digits)
    );

-- Mirror the relaxation on the child tables that reference enterprise_number
-- so foreign-key inserts don't fail their own format checks.
ALTER TABLE public.nace_codes
    DROP CONSTRAINT IF EXISTS nace_codes_enterprise_number_check;
ALTER TABLE public.functions
    DROP CONSTRAINT IF EXISTS functions_enterprise_number_check;
ALTER TABLE public.corporate_mandates
    DROP CONSTRAINT IF EXISTS corporate_mandates_enterprise_number_check;
ALTER TABLE public.filing_references
    DROP CONSTRAINT IF EXISTS filing_references_enterprise_number_check;
ALTER TABLE public.financial_statements
    DROP CONSTRAINT IF EXISTS financial_statements_enterprise_number_check;
