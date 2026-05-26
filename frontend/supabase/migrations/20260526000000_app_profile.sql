-- ============================================================================
-- App-owner profile + ICP. Singleton row for v1 (no auth) — we identify
-- it by a fixed `id = 'default'` and use upsert on that key. The analyzer
-- reads this row to bias the commercial-fit verdict toward the user's
-- stated ideal customer profile.
--
-- Free-text fields throughout: the OpenAI prompt reads the profile as
-- prose and reasons about fit, rather than us forcing rigid filter
-- constraints that can't capture nuance ("avoid recently dissolved
-- companies", "we like aggressive hiring as a signal", etc.).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_profile (
    id                    text PRIMARY KEY DEFAULT 'default',
    company_name          text NOT NULL DEFAULT '',
    company_one_liner     text NOT NULL DEFAULT '',
    offering              text NOT NULL DEFAULT '',
    geo_focus             text NOT NULL DEFAULT '',
    icp_description       text NOT NULL DEFAULT '',
    icp_target_industries text NOT NULL DEFAULT '',
    icp_target_size       text NOT NULL DEFAULT '',
    icp_disqualifiers     text NOT NULL DEFAULT '',
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Seed an empty default row so reads always succeed; the UI shows an
-- empty form on first load and saves overwrite this row.
INSERT INTO public.app_profile (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- Mirror columns onto commercial_analyses so cached analyses retain the
-- ICP-fit verdict alongside the existing financial verdict.
ALTER TABLE public.commercial_analyses
    ADD COLUMN IF NOT EXISTS icp_fit text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.commercial_analyses
    ADD COLUMN IF NOT EXISTS icp_fit_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;
