-- ============================================================================
-- Add an outreach-helper section to commercial_analyses: a one-sentence
-- summary and a list of ready-to-use email hooks the salesperson can paste
-- into a prospecting email. Both default to empty so legacy rows continue
-- to load cleanly until they're regenerated.
-- ============================================================================

ALTER TABLE public.commercial_analyses
    ADD COLUMN IF NOT EXISTS outreach_summary text
        NOT NULL DEFAULT '';

ALTER TABLE public.commercial_analyses
    ADD COLUMN IF NOT EXISTS outreach_email_angles jsonb
        NOT NULL DEFAULT '[]'::jsonb;
