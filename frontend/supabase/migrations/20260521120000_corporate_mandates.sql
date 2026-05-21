-- ============================================================================
-- Corporate-director mandates: edges in the corporate-group graph.
--
-- Belgian companies can name another company on their board. KBO renders
-- these as rows like "Director · ACME HOLDING BV · 0712.345.678". Each
-- such row is a directed edge — "holder_enterprise_number IS director OF
-- enterprise_number". We don't constrain holder_enterprise_number with a
-- foreign key because the holder is often a company we haven't enriched
-- yet (and may never enrich), and an FK would refuse the insert.
--
-- The reverse-index lets us cheaply answer "what companies does CBE X
-- sit on the board of?" → that's the subsidiary lookup powering the
-- group endpoint.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.corporate_mandates (
    enterprise_number          text NOT NULL
        REFERENCES public.companies(enterprise_number) ON DELETE CASCADE,
    holder_enterprise_number   text NOT NULL,
    holder_name                text,
    role                       text NOT NULL,
    since                      date,

    PRIMARY KEY (enterprise_number, holder_enterprise_number, role)
);

CREATE INDEX IF NOT EXISTS corporate_mandates_holder_idx
    ON public.corporate_mandates (holder_enterprise_number);

ALTER TABLE public.corporate_mandates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS corporate_mandates_read_all ON public.corporate_mandates;
CREATE POLICY corporate_mandates_read_all
    ON public.corporate_mandates FOR SELECT USING (true);
