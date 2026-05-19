-- ============================================================================
-- commercial_analyses — cached LLM-generated commercial-fit assessments.
-- ============================================================================
--
-- One row per company. Regenerated on demand via POST /companies/{cbe}/analyze.
-- ``based_on_filing_refs`` records which filings were available at generation
-- time so the frontend can show "analysis outdated" when new filings appear.
--
-- RLS: read-anyone, write-service-role-only (same as the enrichment tables —
-- the analyses are derived from public data and contain no user-specific
-- content).
-- ============================================================================

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

    based_on_filing_refs       text[] NOT NULL DEFAULT '{}',
    model                      text,
    generated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commercial_analyses_generated_idx
    ON public.commercial_analyses (generated_at DESC);

ALTER TABLE public.commercial_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY commercial_analyses_read_all
    ON public.commercial_analyses FOR SELECT USING (true);
