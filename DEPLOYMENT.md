# Deploying to Vercel

This repo deploys as **one** Vercel project that serves both halves of
the stack from a single domain:

| Path                          | Service                            |
|-------------------------------|------------------------------------|
| `/...` (everything else)      | Next.js frontend (`frontend/`)     |
| `/_/backend/...`              | FastAPI backend (`backend/`)       |

The wiring lives in [vercel.json](vercel.json) and uses Vercel's
`experimentalServices` monorepo feature — no separate projects, no
cross-origin CORS to manage, no DNS to wire up. The frontend hits the
backend on the same domain via the `/_/backend` prefix.

---

## 1. Prerequisites

- A Vercel account with **monorepo / experimental services** enabled
  (the `experimentalServices` key in `vercel.json` is the trigger; if
  your account doesn't see it, ping Vercel support to flip the flag).
- GitHub/GitLab/Bitbucket access to push this repo.
- The `vercel` CLI (`npm i -g vercel`) is optional but helps for
  one-off deploys without a Git remote.
- Active credentials for the upstream services this app calls:
  - **NBB CBSO** subscription key — request at
    https://www.nbb.be/en/central-balance-sheet-office/consultation/web-services.
  - **OpenAI** API key — https://platform.openai.com/.
  - **Supabase** project — URL + service-role key + anon key.

---

## 2. One-time Supabase setup

Run the SQL migrations under [backend/supabase/migrations/](backend/supabase/migrations/)
against your Supabase project (Dashboard → SQL Editor, or via the
Supabase CLI). They are idempotent — safe to re-apply.

The most recent one adds the AI-analysis confidence columns
(`confidence_score`, `confidence_factors`); without it, `/companies/{cbe}/analyze`
will fail to persist.

---

## 3. Import the repo into Vercel

1. **Vercel Dashboard → Add New → Project → Import Git Repository**.
2. Pick this repo. Vercel will detect the root `vercel.json` and offer
   to create a monorepo project with two services. Accept.
3. **Root Directory:** leave at the repo root (`/`). Each service's
   `entrypoint` in `vercel.json` already points at its subfolder.
4. **Build & Output Settings:** leave the defaults. Each service is
   built independently from its entrypoint directory:
   - `frontend/` — Vercel auto-detects Next.js and runs `next build`.
   - `backend/` — Vercel's Python runtime auto-detects `api/index.py`
     and installs `requirements.txt` from the backend folder.

---

## 4. Environment variables

Set these in **Project → Settings → Environment Variables**. Mark each
for **Production, Preview, and Development** unless you specifically
want a per-environment override.

### Backend (`backend/` service)

| Variable                       | Value                                                       |
|--------------------------------|-------------------------------------------------------------|
| `NBB_API_SUBSCRIPTION_KEY`     | Your CBSO subscription key                                  |
| `NBB_API_BASE_URL`             | `https://ws.cbso.nbb.be/authentic` (default — only override for sandbox) |
| `OPENAI_API_KEY`               | Your OpenAI key                                             |
| `OPENAI_MODEL`                 | `gpt-4o-mini` (or any model that supports structured outputs) |
| `SUPABASE_URL`                 | `https://<project-ref>.supabase.co`                         |
| `SUPABASE_SERVICE_ROLE_KEY`    | From Supabase → Settings → API                              |
| `CACHE_DIR`                    | `/tmp/.cache` — Vercel's only writable path                 |
| `FASTAPI_ROOT_PATH`            | `/_/backend` — makes `/docs` link generation correct        |
| `CORS_ORIGINS`                 | Same-origin now, but keep e.g. `https://your-project.vercel.app` if you ever expose preview deploys to a different domain |

### Frontend (`frontend/` service)

| Variable                       | Value                                |
|--------------------------------|--------------------------------------|
| `NEXT_PUBLIC_API_URL`          | `/_/backend`                         |

Setting `NEXT_PUBLIC_API_URL` to a **relative** path is the whole
point of running both halves on one Vercel project — the browser
hits `https://your-project.vercel.app/_/backend/companies/...` and
Vercel routes it to the Python service. No CORS, no second domain.

The Supabase keys (`SUPABASE_ANON_KEY` etc.) are **not** needed on the
frontend since the dashboard talks to the FastAPI backend, not to
Supabase directly.

---

## 5. Deploy

Push to your default branch (usually `main`) — Vercel builds both
services in parallel and ships them under one domain. Each PR also
gets its own preview URL.

CLI alternative:

```bash
vercel --prod
```

from the repo root.

---

## 6. Verify

After the deploy goes green:

1. **Backend health**
   ```
   curl https://<your-project>.vercel.app/_/backend/health
   ```
   Should return JSON with `services.nbb`, `services.openai`,
   `services.supabase` — each `true` if the env var is set.

2. **Backend OpenAPI**
   `https://<your-project>.vercel.app/_/backend/docs` should render
   Swagger UI with the right `/_/backend` prefix on every endpoint
   (this is why `FASTAPI_ROOT_PATH` is set).

3. **Frontend**
   `https://<your-project>.vercel.app/` should load the dashboard
   and the Overview tiles should populate from `/stats` (which the
   frontend calls relative-path through `/_/backend/stats`).

---

## 7. Known constraints on Vercel

These are baked into the serverless platform, not bugs:

- **Cold starts.** A request to a cold Python lambda can take 2–4s
  before any code runs. Subsequent requests on the warm instance are
  fast. Cache hits in the in-memory `FastAPICache` survive only on a
  single warm instance; if you scale beyond one, swap the cache
  backend to Redis (`backend/src/api/main.py`, `lifespan`).
- **Read-only filesystem outside `/tmp`.** The PDF/XBRL on-disk cache
  in `backend/src/nbb/client.py` falls back to a best-effort write
  (logs and continues on `OSError`). Supabase is the durable store.
- **60s max execution.** Pipelines that fetch + extract + LLM-analyze
  multiple filings in one HTTP request can run close to this limit.
  For very heavy work, use `/companies/bulk` with `refresh=false` to
  hit cached data, or run heavy ingestion offline.
- **No background tasks / no cron** unless you use Vercel Cron
  Jobs (configured separately) or Vercel Queues.
- **`experimentalServices` is, well, experimental.** The shape of
  the config key may change. Watch the Vercel changelog.

---

## 8. Local development is unchanged

Nothing in this deployment setup affects local dev. Keep running:

```bash
# backend
cd backend && uvicorn src.api.main:app --reload --port 8000

# frontend (separate terminal)
cd frontend && npm run dev
```

Locally, `NEXT_PUBLIC_API_URL` falls back to `http://localhost:8000`
when not set, and `FASTAPI_ROOT_PATH` defaults to empty so routes
match without a prefix.
