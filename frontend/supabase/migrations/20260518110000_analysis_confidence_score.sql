-- ============================================================================
-- Add a numeric confidence (0-100) to commercial_analyses, alongside the
-- existing categorical `confidence` column.
--
-- The numeric value is required for new rows but nullable here so existing
-- analyses (generated before this column existed) don't fail the
-- back-fill. The LLM populates both fields on the next regeneration; until
-- then, those legacy rows show only the categorical value in the UI.
-- ============================================================================

ALTER TABLE public.commercial_analyses
    ADD COLUMN IF NOT EXISTS confidence_score integer
        CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100);

ALTER TABLE public.commercial_analyses
    ADD COLUMN IF NOT EXISTS confidence_factors jsonb
        NOT NULL DEFAULT '[]'::jsonb;
