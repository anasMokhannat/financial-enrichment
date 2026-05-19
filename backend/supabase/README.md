# Supabase

> First-time wiring? Follow **[SETUP.md](SETUP.md)** — it's the
> step-by-step guide with click-by-click instructions and a
> verification script.

This README is the reference for what's in the folder. Five tables, all
caching reference data we pull from KBO and NBB:

| Table | Holds |
|---|---|
| `companies` | one row per Belgian enterprise number |
| `nace_codes` | NACE classifications per company |
| `functions` | directors / managers / auditors |
| `filing_references` | every annual filing reference from NBB |
| `financial_statements` | extracted financials per filing |

Schema lives in [migrations/](migrations/). Newest file is the
current truth; older files are kept for history (and for
`supabase db push` if you adopt the CLI).

## Apply the schema

Pick one of the two paths.

### Path A — Supabase dashboard (quickest)

1. Open your project at <https://supabase.com/dashboard>.
2. Go to **SQL Editor → New query**.
3. Copy the contents of the newest file in `migrations/` and run it.
4. Verify under **Database → Tables** that the five tables exist with
   RLS enabled.

### Path B — Supabase CLI (preferred for repeat deploys)

```powershell
# Install once: https://supabase.com/docs/guides/cli
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

The CLI applies every file under `migrations/` in lexicographic order
and tracks them in the `supabase_migrations` table on your project so
re-runs are idempotent.

## Get the keys you need

In **Project Settings → API** copy the three values into your
project's `.env`:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
```

- **Service role** bypasses RLS — used by the Python backend
  (`src/db/client.py:get_service_client`) for ingestion. Never expose
  to the browser.
- **Anon key** is what the Next.js frontend ships. It is subject to
  RLS, which for these tables means SELECT only — the world can read
  but only the backend can write.

## Row-Level Security cheat sheet

| Table | Read | Write |
|---|---|---|
| `companies` | anyone | service role only |
| `nace_codes` | anyone | service role only |
| `functions` | anyone | service role only |
| `filing_references` | anyone | service role only |
| `financial_statements` | anyone | service role only |

The service-role client bypasses RLS entirely, so the backend can
write without explicit INSERT/UPDATE/DELETE policies.
