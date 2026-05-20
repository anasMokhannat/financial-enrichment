# legal-financial-enrichment — Documentation

End-to-end enrichment for Belgian companies: resolve a company name or
CBE (enterprise) number and return a structured report containing the
legal profile (from KBO), the latest annual filings (from NBB CBSO),
extracted financial statements (XBRL), and an optional AI-generated
commercial-fit analysis (OpenAI).

The application is delivered as a single **Next.js 15 fullstack app**
that owns both the UI and the upstream integrations. A legacy
**Python FastAPI backend** (`backend/`) is kept in the repository as
the reference implementation that the TypeScript port was derived
from.

---

## Table of contents

1. [Installation guide](#1-installation-guide)
2. [What the application does (services)](#2-what-the-application-does-services)
3. [Architecture](#3-architecture)
4. [Data providers and how to use them](#4-data-providers-and-how-to-use-them)
5. [Repository layout](#5-repository-layout)

---

## 1. Installation guide

### 1.1 Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18.18+ (20 LTS recommended) | Next.js 15 requirement |
| npm | bundled with Node | `pnpm` / `yarn` also work |
| Git | any recent | clone the repo |
| (optional) Python | 3.10+ | only to run the legacy FastAPI backend |

You also need credentials for the upstream services described in
[§ 4](#4-data-providers-and-how-to-use-them):

- **NBB CBSO** subscription key
- **Supabase** project URL + service-role key
- **OpenAI** API key (optional — only the commercial-analysis feature
  requires it)

### 1.2 Clone and install

```powershell
git clone <repo-url> legal-financial-enrichment
cd legal-financial-enrichment\frontend
npm install
```

### 1.3 Configure environment

```powershell
copy .env.local.example .env.local
```

Edit `.env.local` and fill in the keys. The full reference is in
[frontend/.env.local.example](frontend/.env.local.example); the
minimum to boot is:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
NBB_API_SUBSCRIPTION_KEY=<your-cbso-key>
OPENAI_API_KEY=sk-...            # optional
OPENAI_MODEL=gpt-4o-mini         # optional
```

All variables are server-only. None of them carries the
`NEXT_PUBLIC_` prefix — the browser never sees these secrets because
all upstream calls happen inside Next.js Route Handlers.

### 1.4 One-time Supabase setup

1. Create a project at <https://supabase.com>.
2. Open **SQL Editor**, paste the contents of
   [frontend/supabase/schema.sql](frontend/supabase/schema.sql), and
   run it. The script is idempotent.
3. Verify in **Table Editor** that the following six tables exist:
   `companies`, `nace_codes`, `functions`, `filing_references`,
   `financial_statements`, `commercial_analyses`.
4. Copy **Project URL** and **service_role key** from
   *Settings → API* into `.env.local`.

See [frontend/supabase/README.md](frontend/supabase/README.md) for
incremental migrations.

### 1.5 Run the dev server

```powershell
cd frontend
npm run dev
```

Open <http://localhost:3000>. The dashboard, the API routes
(`/api/...`), and all server-side business logic run inside the same
Next.js process — there is no second service to start.

### 1.6 Build for production

```powershell
cd frontend
npm run build
npm run start
```

For deployment to Vercel as a single project (frontend + Python
backend co-located), see [DEPLOYMENT.md](DEPLOYMENT.md).

### 1.7 (Optional) Run the legacy Python backend

The original FastAPI service still works and is documented in
[backend/README.md](backend/README.md). It is **not required** by the
Next.js app — the TypeScript port in `frontend/lib/server/` is the
active implementation.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # fill in keys
.\.venv\Scripts\uvicorn.exe src.api.main:app --reload --port 8000
```

Swagger UI: <http://localhost:8000/docs>.

---

## 2. What the application does (services)

The product is a B2B prospecting / due-diligence dashboard. From a
single name or CBE number it produces a `CompanyFinancialReport`
containing the legal profile, the latest filings, extracted financial
statements, and an optional commercial-fit verdict.

### 2.1 User-facing pages

| Route | Purpose |
|---|---|
| `/` | Overview — hero card, KPI tiles, recent companies strip |
| `/search` | Search box; on ambiguous KBO matches renders a candidate dropdown |
| `/companies/[cbe]` | Company detail — legal profile, filings, ratios row, charts, annexe, commercial-analysis panel |
| `/companies/[cbe]/annexe` | Filing annexe view |
| `/bulk` | Bulk lookup over multiple queries |

### 2.2 HTTP API (Next.js Route Handlers)

All endpoints live under `/api/` and are same-origin with the
dashboard. The frontend hits them through the typed wrapper in
[frontend/lib/api.ts](frontend/lib/api.ts).

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/health` | Boot snapshot: which of NBB / OpenAI / Supabase are configured |
| GET | `/api/stats` | Aggregate counts that power the Overview tiles |
| GET | `/api/companies?limit&offset` | Paginated list of cached companies (cache-only; 503 without Supabase) |
| GET | `/api/companies/search?q=&refresh=&filings=` | Resolve a name or CBE to a `CompanyFinancialReport`. Returns **409** on ambiguous KBO names with a `candidates[]` list. Returns **404** when unknown |
| GET | `/api/companies/[cbe]?refresh=&filings=` | Same as `search` but assumes the path is a CBE. Returns **400** on bad format |
| POST | `/api/companies/[cbe]/refresh` | Force a fresh pipeline run and persist the result to Supabase |
| GET | `/api/companies/[cbe]/legal` | Cached legal profile only (Company + NACE + functions) |
| GET | `/api/companies/[cbe]/filings` | Cached `FilingReference[]` |
| GET | `/api/companies/[cbe]/statements` | Cached `FinancialStatement[]` |
| GET | `/api/companies/[cbe]/analysis` | Cached commercial-fit analysis (404 if not yet generated) |
| POST | `/api/companies/[cbe]/analyze` | Generate, cache, and return a fresh commercial-fit analysis |
| POST | `/api/companies/bulk` | Up to 100 queries in one call, capped at 5 concurrent pipeline runs |

### 2.3 Cache semantics

- A CBE lookup checks Supabase first and serves cached data when at
  least one `financial_statement` row is present.
- A name lookup always runs the pipeline because KBO must resolve the
  name to a CBE before anything can be cached.
- `refresh=true` skips the read but still writes the fresh result back.
- The `legal`, `filings`, `statements` and `analysis` endpoints are
  **cache-only** — they never trigger the pipeline. Call `search` or
  `/companies/{cbe}` once to populate the cache, then read the
  derivative endpoints.

### 2.4 Ambiguous-match contract

When KBO returns multiple matches for a name, the API replies with
**409 Conflict**:

```json
{
  "detail": {
    "code": "ambiguous_match",
    "message": "12 KBO matches for 'flugia'; refine the query.",
    "candidates": [
      { "enterprise_number": "0712345678", "name": "FLUGIA BV", "address": "…" }
    ]
  }
}
```

The client wrapper ([frontend/lib/api.ts](frontend/lib/api.ts))
detects this shape and throws `AmbiguousMatchApiError`. The search
page catches it and renders an
[`AmbiguousMatches`](frontend/components/AmbiguousMatches.tsx)
dropdown; picking a candidate navigates to
`/companies/{enterprise_number}`, which is unambiguous by definition.

---

## 3. Architecture

### 3.1 High-level picture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                          │
│   ─ React 19 pages under app/                                     │
│   ─ Calls /api/... same-origin via lib/api.ts                     │
└────────────────────────────────┬──────────────────────────────────┘
                                 │ HTTP (same origin)
┌────────────────────────────────▼──────────────────────────────────┐
│  Next.js Route Handlers · app/api/...                             │
│   ─ Thin HTTP plumbing; validates input, returns JSON             │
└────────────────────────────────┬──────────────────────────────────┘
                                 │
┌────────────────────────────────▼──────────────────────────────────┐
│  Server library · lib/server/                                     │
│                                                                    │
│    EnrichmentPipeline.run(query)                                  │
│    ├── KBOScraper.lookup()       → Company                        │
│    ├── NBBClient.latestReferences() → FilingReference[]           │
│    └── XbrlExtractor.extract()      → FinancialStatement          │
│                                                                    │
│    AnalysisAnalyzer.generate()  → CommercialAnalysis              │
│    EnrichmentRepository         ↔ Supabase Postgres               │
└──────┬───────────────────┬──────────────────┬───────────────────┬─┘
       │                   │                  │                   │
       ▼                   ▼                  ▼                   ▼
   KBO public        NBB CBSO            OpenAI Chat       Supabase
   (HTML scrape)     (Subscription-Key,  (json_schema)     Postgres
                     XBRL via Accept                       (cache layer)
                     header)
```

The browser never speaks directly to KBO, NBB, OpenAI, or Supabase.
Every upstream credential lives in `process.env` on the Next.js
server and is read once at boot via
[frontend/lib/server/config.ts](frontend/lib/server/config.ts).

### 3.2 Layers inside `frontend/lib/server/`

| Layer | Modules | Responsibility |
|---|---|---|
| **Orchestration** | `pipeline.ts` | `EnrichmentPipeline.run(query)` — the single entry point that composes KBO → NBB → XBRL into a `CompanyFinancialReport` |
| **Adapters** | `kbo/scraper.ts`, `nbb/client.ts`, `extraction/xbrl.ts`, `analysis/analyzer.ts` | One adapter per external source. Each owns its HTTP client, auth, and parser, and returns Zod-validated models |
| **Persistence** | `db/repository.ts` | `EnrichmentRepository` — Supabase service-role client. Reads cached reports, writes pipeline output |
| **Domain model** | `models.ts` | Zod schemas + inferred TS types (`Company`, `FilingReference`, `FinancialStatement`, `CompanyFinancialReport`, `CommercialAnalysis`) |
| **Cross-cutting** | `config.ts`, `enterpriseNumber.ts`, `errors.ts`, `http.ts` | Env reading, CBE normalisation, typed error hierarchy, HTTP response helpers |

The Route Handlers under `app/api/...` are pure plumbing: parse
query parameters, call the relevant `lib/server/` function, return
`ok()` / `fail()` / `errorResponse()` from `http.ts`. No business
logic lives in the handlers.

### 3.3 Sequence of a single lookup

For a query like `Colruyt Group SA` with no cached result:

1. Browser → `GET /api/companies/search?q=Colruyt%20Group%20SA`.
2. Route handler asks `EnrichmentRepository.getReport()` — Supabase
   miss because the input is a name, not a CBE.
3. Route handler constructs `EnrichmentPipeline` and calls `run()`.
4. `KBOScraper.lookup()` hits the public-search form
   (`zoeknaamfonetischform.html`), then the detail page
   (`toonondernemingps.html`), and returns a `Company` (CBE, legal
   form, NACE, directors, status, address).
5. `NBBClient.latestReferences(cbe, 3)` calls
   `/legalEntity/{cbe}/references` with the subscription-key header
   and returns the three most recent `FilingReference[]`.
6. For each filing, `XbrlExtractor.extract(cbe, ref)` calls
   `/deposit/{reference}/accountingData` with
   `Accept: application/x.xbrl`, parses the BeNGAAP taxonomy with
   `fast-xml-parser`, and maps tagged facts to the 14 numeric fields
   of `FinancialStatement`.
7. `EnrichmentRepository.saveReport()` upserts the company, NACE
   codes, functions, filing references and financial statements into
   Supabase.
8. Handler returns the full `CompanyFinancialReport` as JSON.

A subsequent identical request is served from Supabase in step 2 and
skips steps 3–7 entirely.

### 3.4 The commercial-analysis side-channel

Triggered by **POST `/api/companies/[cbe]/analyze`** when the user
clicks the *Run analysis* button:

1. Route handler loads the cached `CompanyFinancialReport` from
   Supabase.
2. `AnalysisAnalyzer.generate(report)` sends a tight system prompt +
   the report to OpenAI Chat Completions with
   `response_format: { type: "json_schema", strict: true }`. The
   schema is generated from the `CommercialAnalysis` Zod schema, so
   the model's output is guaranteed to parse.
3. The analyzer returns a `CommercialAnalysis` containing
   `verdict ∈ {strong, stable, watch, risky, avoid}`, a one-sentence
   summary, strengths, concerns, a credit recommendation, a
   `confidence` level, and the model name used.
4. The result is upserted into `commercial_analyses` and returned to
   the caller. The cached `GET /analysis` route serves it on
   subsequent reads.

### 3.5 Why both implementations exist

The Python backend in [backend/](backend/) is the original
implementation. The TypeScript code under
[frontend/lib/server/](frontend/lib/server/) is a 1:1 port (see the
header comments in each file: *"Port of backend/src/..."*). The
Python tree is preserved as a reference so that behaviour can be
cross-checked end-to-end before the legacy stack is removed. They
share Supabase — either side can read and write the same tables.

---

## 4. Data providers and how to use them

The pipeline integrates four external services. Each section below
covers what the service is, where it's wired in, what credentials it
needs, and how the application uses it.

### 4.1 KBO — Kruispuntbank van Ondernemingen (Belgian company register)

| Property | Value |
|---|---|
| **Endpoint** | `https://kbopub.economie.fgov.be/kbopub/` |
| **Auth** | None — public search |
| **Module** | [frontend/lib/server/kbo/scraper.ts](frontend/lib/server/kbo/scraper.ts) (port of `backend/src/kbo/scraper.py`) |
| **Used for** | Resolving a company name to a CBE; loading the legal profile (legal form, status, address, NACE codes, directors, VAT subject) |

There is no JSON API, so the scraper submits the phonetic name
search form, parses the HTML results with `cheerio`, and then fetches
the detail page (`toonondernemingps.html`) for canonical fields.

When the input is already a 10-digit CBE, the scraper skips the
search step and hits the detail page directly. When the search
returns multiple candidates, the scraper throws `AmbiguousMatchError`
with the candidate list — the handler converts it to HTTP 409 so the
search UI can render a dropdown.

**Constraints.** Reuse of CBE data is restricted; only do targeted,
single-entity lookups on demand. Bulk needs should go through the
official monthly CSV extracts, not this scraper.

**No environment variables.** KBO is unauthenticated. Be polite with
the request rate.

### 4.2 NBB CBSO — Authentic Data Query API

| Property | Value |
|---|---|
| **Endpoint** | `https://ws.cbso.nbb.be/authentic` |
| **Auth** | `NBB-CBSO-Subscription-Key: <key>` header |
| **Module** | [frontend/lib/server/nbb/client.ts](frontend/lib/server/nbb/client.ts) (port of `backend/src/nbb/client.py`) |
| **Used for** | (a) listing every annual filing for a CBE; (b) downloading the XBRL deliverable for each filing |

The client exposes:

- `latestReferences(cbe, n)` → `FilingReference[]` (sorted, latest
  first). Calls `GET /legalEntity/{cbe}/references` and parses the
  filing list.
- `downloadXbrl(reference)` → `Buffer`. Calls
  `GET /deposit/{reference}/accountingData` with
  `Accept: application/x.xbrl` — the vendor MIME triggers XBRL;
  the standard `application/xbrl+xml` MIME returns a PDF, which the
  current pipeline doesn't process.

**Environment**

```env
NBB_API_BASE_URL=https://ws.cbso.nbb.be/authentic
NBB_API_SUBSCRIPTION_KEY=<your-subscription-key>
NBB_DEPOSIT_PATH=/deposit/{reference}/accountingData    # change to plural on some tiers
HTTP_TIMEOUT_MS=30000
```

**How to obtain a key.** Request access via the
[CBSO order form](https://www.nbb.be/en/central-balance-sheet-office/consultation/web-services).
A subscription is required and may take a few business days to
activate.

**Failure handling.** Network errors throw `NBBClientError`; missing
filings throw `NBBNotFoundError`. The route handler maps these to
504 / 404. Some abbreviated and pre-2007 filings have no XBRL — the
`XbrlExtractor` returns `null` for those and the pipeline emits an
empty `unknown`-source `FinancialStatement` so the filing still
appears in the list.

### 4.3 OpenAI — Chat Completions (commercial-fit analyzer)

| Property | Value |
|---|---|
| **Endpoint** | `https://api.openai.com/v1/chat/completions` |
| **Auth** | `Authorization: Bearer $OPENAI_API_KEY` |
| **Module** | [frontend/lib/server/analysis/analyzer.ts](frontend/lib/server/analysis/analyzer.ts) (port of `backend/src/analysis/analyzer.py`) |
| **Used for** | Generating a commercial-fit `CommercialAnalysis` (verdict, strengths, concerns, recommendation, confidence) from a cached `CompanyFinancialReport` |

The analyzer uses the OpenAI JS SDK's structured-output mode
(`response_format: { type: "json_schema", strict: true }`), so the
returned JSON is guaranteed to match the `CommercialAnalysis` schema
and can be parsed without trusting the model. Typical cost is well
under USD 0.01 per call on `gpt-4o-mini`.

**Environment**

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini    # any model that supports structured outputs
```

**Optional.** Without `OPENAI_API_KEY` the rest of the app works
unchanged; only the commercial-analysis panel displays
*"OpenAI not configured"* and `POST /analyze` returns a 503-style
error.

**How to use it from the UI.**

1. Open `/companies/[cbe]` for a company that has cached statements.
2. Open the **Commercial Analysis** panel.
3. Click **Run analysis** — this calls `api.generateAnalysis(cbe)`,
   which hits `POST /api/companies/[cbe]/analyze`, persists the
   result, and re-renders the panel with the verdict and bullets.
4. Subsequent visits read the cached row via `GET /analysis` without
   another OpenAI call.

### 4.4 Supabase Postgres — durable cache

| Property | Value |
|---|---|
| **Endpoint** | `<SUPABASE_URL>` (e.g. `https://<project-ref>.supabase.co`) |
| **Auth** | `SUPABASE_SERVICE_ROLE_KEY` (server-only — bypasses RLS) |
| **Module** | [frontend/lib/server/db/repository.ts](frontend/lib/server/db/repository.ts) |
| **Schema** | [frontend/supabase/schema.sql](frontend/supabase/schema.sql) |
| **Used for** | Caching every `CompanyFinancialReport` and `CommercialAnalysis` produced by the pipeline, plus the list/stats endpoints |

The repository exposes the cache surface used by the route handlers:

- `getReport(cbe)` — load a full report (company + filings +
  statements) by CBE, or `null` if not cached.
- `saveReport(report, extractor)` — UPSERT the company, NACE codes,
  functions, filing references and financial statements. Triggers
  `companies.last_refreshed_at`.
- `listCompanies({ limit, offset })` and
  `statementCountsByEnterprise(...)` — power
  `GET /api/companies` and the Overview tiles.
- `getAnalysis(cbe)` / `saveAnalysis(...)` — back the
  commercial-analysis endpoints.

**Tables.** Six tables: `companies`, `nace_codes`, `functions`,
`filing_references`, `financial_statements`,
`commercial_analyses`. `financial_statements.reference` is the
primary key, so re-ingesting the same filing is a clean UPSERT.

**Environment**

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

**Optional.** If neither variable is set, the repository factory
returns `null`. The pipeline still runs on every request — it just
doesn't persist results, and the cache-only endpoints (`legal`,
`filings`, `statements`, `analysis`, `companies` list) return **503**.

**How to bootstrap.** See [§ 1.4](#14-one-time-supabase-setup) or the
detailed walkthrough in
[frontend/supabase/README.md](frontend/supabase/README.md).

### 4.5 Summary

| Provider | Required? | Used by | Failure mode if missing |
|---|---|---|---|
| KBO | yes | every lookup that starts from a name | none — public, always reachable |
| NBB CBSO | yes | every pipeline run | pipeline cannot fetch filings → 5xx |
| Supabase | recommended | caching + cache-only endpoints | pipeline runs on every request; cache endpoints return 503 |
| OpenAI | optional | commercial-fit analyzer | analyze endpoints unavailable; rest of app unaffected |

---

## 5. Repository layout

```
legal-financial-enrichment/
├── frontend/                       Next.js 15 fullstack app (active)
│   ├── app/
│   │   ├── page.tsx                Overview
│   │   ├── search/                 Search page
│   │   ├── companies/[cbe]/        Company detail + annexe
│   │   ├── bulk/                   Bulk lookup
│   │   └── api/                    Route Handlers (the HTTP API)
│   │       ├── health/
│   │       ├── stats/
│   │       └── companies/
│   │           ├── route.ts                (GET list)
│   │           ├── search/route.ts
│   │           ├── bulk/route.ts
│   │           └── [cbe]/
│   │               ├── route.ts            (GET single)
│   │               ├── refresh/route.ts
│   │               ├── legal/route.ts
│   │               ├── filings/route.ts
│   │               ├── statements/route.ts
│   │               ├── analysis/route.ts
│   │               └── analyze/route.ts
│   ├── components/                 UI: TopBar, Sidebar, CompanyReport,
│   │                               CommercialAnalysisPanel, charts, etc.
│   ├── lib/
│   │   ├── api.ts                  Typed fetch wrapper (browser-side)
│   │   ├── types.ts                Wire types
│   │   ├── ratios.ts               Ratio computation
│   │   └── server/                 Server-only business logic
│   │       ├── pipeline.ts         EnrichmentPipeline orchestrator
│   │       ├── kbo/scraper.ts      KBO public-search scraper
│   │       ├── nbb/client.ts       NBB CBSO XBRL client
│   │       ├── extraction/         XBRL parser + heading map
│   │       ├── analysis/analyzer.ts OpenAI commercial-fit analyzer
│   │       ├── db/repository.ts    Supabase repository
│   │       ├── models.ts           Zod schemas + types
│   │       ├── config.ts           Env reader
│   │       ├── enterpriseNumber.ts CBE normalisation
│   │       ├── errors.ts           Typed error hierarchy
│   │       └── http.ts             Response helpers
│   ├── supabase/                   Schema + migrations
│   │   ├── schema.sql
│   │   └── migrations/
│   ├── .env.local.example
│   ├── package.json
│   └── README.md
│
├── backend/                        Python FastAPI service (reference)
│   ├── src/
│   │   ├── api/                    FastAPI app, routes, schemas
│   │   ├── kbo/                    KBO scraper
│   │   ├── nbb/                    NBB client
│   │   ├── extraction/             LLM + regex + XBRL extractors
│   │   ├── analysis/               Commercial-fit analyzer
│   │   ├── db/                     Supabase repo
│   │   ├── pipeline.py
│   │   ├── models.py
│   │   └── config.py
│   ├── supabase/                   (older copy of the migrations)
│   ├── scripts/                    compare_extractors.py
│   ├── requirements.txt
│   └── .env.example
│
├── diagrams/ARCHITECTURE.md        Mermaid diagrams (system context,
│                                   components, sequence, data model)
├── DEPLOYMENT.md                   Vercel monorepo deployment guide
├── DOCUMENTATION.md                This file
└── README.md                       One-page quick start
```

---

## See also

- [README.md](README.md) — one-page quick start
- [DEPLOYMENT.md](DEPLOYMENT.md) — Vercel monorepo deployment guide
- [diagrams/ARCHITECTURE.md](diagrams/ARCHITECTURE.md) — five Mermaid
  diagrams (system context → component → sequence → data model →
  design notes)
- [frontend/README.md](frontend/README.md) — frontend-specific notes
  (design system, ambiguous-match handling)
- [backend/README.md](backend/README.md) — legacy Python backend
- [frontend/supabase/README.md](frontend/supabase/README.md) — schema
  bootstrap and migration history
