# Supabase setup

This folder is the source of truth for the database schema used by the
Next.js app.

```
supabase/
├── schema.sql        ← one-shot bootstrap for a fresh project
└── migrations/       ← per-step migrations (history)
    ├── 20260515000000_initial_schema.sql
    ├── 20260518000000_commercial_analyses.sql
    └── 20260518110000_analysis_confidence_score.sql
```

## Bootstrap a fresh project

1. Create a project on [supabase.com](https://supabase.com).
2. Open **SQL Editor**.
3. Paste the entire contents of [schema.sql](./schema.sql) and run it.
4. Verify in **Table Editor** that you see six tables: `companies`,
   `nace_codes`, `functions`, `filing_references`, `financial_statements`,
   `commercial_analyses`.
5. **Settings → API** — copy the **Project URL** and the **service_role**
   key. Put them in `.env.local` as `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`.

`schema.sql` is idempotent — running it on a project that already has
the schema is a no-op.

## Apply against a project that already has earlier migrations

Run each file under `migrations/` in filename order. They are
idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.) so
re-applying is safe.

If you have the [Supabase CLI](https://supabase.com/docs/guides/cli)
linked to your project:

```bash
cd frontend
supabase db push
```

## How the app reads/writes

- The Route Handlers under `app/api/...` use the **service-role key**
  (RLS-bypassing) for all reads and writes.
- The frontend never hits Supabase directly; it always goes through
  `app/api/...`. So the **anon key** isn't actually used by this
  codebase, but the RLS policies in `schema.sql` make the public
  reference data readable through it if you ever wire it up.

## Schema notes worth knowing

- `financial_statements.reference` is the primary key (no synthetic id),
  so re-ingesting the same filing is a clean UPSERT.
- `commercial_analyses.confidence_score` is nullable for legacy rows
  generated before the column existed; new rows always populate it.
- `companies.last_refreshed_at` is auto-bumped on UPDATE via a trigger
  in `schema.sql` — the repository code also sets it explicitly, which
  is belt-and-braces.
