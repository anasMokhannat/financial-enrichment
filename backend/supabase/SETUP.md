# Connecting Supabase — step by step

End-to-end checklist to wire Supabase persistence to the backend.
Allow ~10 minutes the first time.

---

## 1. Create the project

1. Go to <https://supabase.com> and sign in (or sign up).
2. Click **New project** in the top right of the dashboard.
3. Fill in:
   - **Name**: anything. `legal-financial-enrichment` works.
   - **Database Password**: generate one and store it in your password
     manager. You won't need it for the API — only for direct Postgres
     access — but Supabase will refuse to create the project without it.
   - **Region**: pick the closest to where the FastAPI backend runs.
     `Europe (Frankfurt)` is a sensible default given the data is
     Belgian.
   - Plan: **Free** is enough for this build.
4. Click **Create new project**. Provisioning takes 1–2 minutes; the
   dashboard shows a spinner during that time.

## 2. Apply the schema

The SQL lives in [`migrations/20260515000000_initial_schema.sql`](migrations/20260515000000_initial_schema.sql).
It creates the five tables (`companies`, `nace_codes`, `functions`,
`filing_references`, `financial_statements`) plus indexes and RLS
policies.

Once the project is **READY** (green status in the project header):

1. Open the project. In the left navigation, click the **SQL Editor**
   icon (looks like a code bracket).
2. Click **+ New query** at the top right.
3. Open
   [`migrations/20260515000000_initial_schema.sql`](migrations/20260515000000_initial_schema.sql)
   in your editor, copy everything, paste into the Supabase query
   window.
4. Click **Run** (or press Ctrl/Cmd+Enter).
5. You should see `Success. No rows returned.` at the bottom.

Verify the tables exist:

1. In the left nav, open **Database → Tables**.
2. You should see five tables under the `public` schema: `companies`,
   `nace_codes`, `functions`, `filing_references`, `financial_statements`.
3. Each shows a small green RLS-enabled badge.

## 3. Grab the keys

1. In the left nav, open **Project Settings → API**.
2. Copy the **Project URL** (looks like `https://abcd1234.supabase.co`).
3. Under **Project API keys**, copy:
   - **`service_role`** — long JWT starting with `eyJ...`. **Server-side
     only**. Bypasses RLS. Never put this in the frontend.
   - **`anon`** — also a long JWT. Safe to ship to the browser. Subject
     to RLS.

## 4. Paste them into the backend `.env`

Inside `backend/`:

```powershell
copy .env.example .env   # if you haven't already
```

Open `backend/.env` and fill in:

```
SUPABASE_URL=https://abcd1234.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...<the service_role key>...
SUPABASE_ANON_KEY=eyJ...<the anon key>...
```

The other variables (`NBB_API_*`, `OPENAI_API_KEY`) should already be
set from earlier phases — leave them as-is.

## 5. Verify from Python

Run the verification script:

```powershell
cd backend
..\.venv\Scripts\python.exe scripts\verify_supabase.py
```

You should see:

```
SUPABASE_URL                 ok  https://abcd1234.supabase.co
service_role key             ok  (1234 chars)
anon key                     ok  (1234 chars)
client connect               ok
table companies              ok  (0 rows)
table nace_codes             ok  (0 rows)
table functions              ok  (0 rows)
table filing_references      ok  (0 rows)
table financial_statements   ok  (0 rows)

All checks passed — Supabase is wired up.
```

If any line says `fail`, the message right next to it describes the
exact cause (missing env var, wrong key, missing table, RLS denial).

## 6. Verify end-to-end via the API

Start the API:

```powershell
cd backend
..\.venv\Scripts\uvicorn.exe src.api.main:app --reload --port 8000
```

Then in a second terminal:

```powershell
curl http://localhost:8000/health
```

You should see:

```json
{
  "status": "ok",
  "services": { "nbb": true, "openai": true, "supabase": true }
}
```

The `supabase: true` line confirms `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are picked up. Now hit a real lookup — the
first call runs the pipeline, the second one serves from the
Supabase cache:

```powershell
# Slow (first time)
curl "http://localhost:8000/companies/search?q=0400378485"
# Fast (cached)
curl "http://localhost:8000/companies/search?q=0400378485"
```

The second response will have `"from_cache": true`. That's confirmation
that data went into and came back out of the database.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `SupabaseUnavailableError: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.` | The Python process didn't pick up `.env`. Make sure you're running from `backend/` and that `.env` is at `backend/.env` (not the repo root). |
| `permission denied for table companies` | You used the **anon** key instead of the **service_role** key for `SUPABASE_SERVICE_ROLE_KEY`. They start with the same `eyJ...` prefix; double-check by length (service-role JWTs are noticeably longer). |
| `relation "companies" does not exist` | The migration didn't run. Re-open the SQL Editor and run the file again. Statements are idempotent (`CREATE TABLE IF NOT EXISTS`), so it's safe to re-run. |
| API returns `"supabase": false` in `/health` | Same as the first row — env not loaded. Restart `uvicorn` after editing `.env`. |
| Frontend Refresh button works but doesn't persist | The frontend doesn't talk to Supabase directly; it always goes through `/companies/{cbe}/refresh`. If that endpoint runs the pipeline but `/health` says `supabase: false`, the backend can't write — fix the backend `.env` and the next refresh will land. |
