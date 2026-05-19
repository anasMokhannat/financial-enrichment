# backend

FastAPI service + enrichment pipeline. Everything that runs server-side
lives here.

## Layout

```
backend/
├── src/
│   ├── api/              FastAPI app, routes, dependencies, schemas
│   ├── kbo/              KBO public-search scraper
│   ├── nbb/              NBB CBSO Authentic Data Query client
│   ├── extraction/       LLM + regex financial extractors, segmenter
│   ├── db/               Supabase repository (EnrichmentRepository)
│   ├── pipeline.py       EnrichmentPipeline orchestrator
│   ├── models.py         Pydantic domain models
│   ├── config.py         Settings (env-driven)
│   ├── exceptions.py     Typed error hierarchy
│   ├── _enterprise_number.py
│   └── _timing.py
├── supabase/             Migrations + setup README
├── scripts/              compare_extractors.py (regex vs LLM bench)
├── requirements.txt
└── .env.example
```

## Setup

```powershell
# from the repo root
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
copy backend\.env.example backend\.env
# fill in your keys: NBB_API_SUBSCRIPTION_KEY, OPENAI_API_KEY, SUPABASE_*
```

If you prefer a venv inside `backend/`, create it there instead:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Apply the Supabase schema once: see [supabase/README.md](supabase/README.md).

## Run

```powershell
cd backend
..\.venv\Scripts\uvicorn.exe src.api.main:app --reload --port 8000
```

(If your venv is inside `backend/`, drop the `..\`.)

The API is documented in [src/api/README.md](src/api/README.md). Open
<http://localhost:8000/docs> for the Swagger UI.

## What lives where (one-liner per package)

- `src/api/`: HTTP layer. Pure plumbing — no business logic.
- `src/pipeline.py`: orchestrator. KBO → NBB → extractor → report.
- `src/kbo/`: HTML scraper for kbopub.economie.fgov.be (resolves name → CBE, returns legal profile).
- `src/nbb/`: NBB CBSO REST client (filing references + PDFs).
- `src/extraction/`: LLM extractor (default) + regex extractor (fallback) + page segmenter + token-budget guard.
- `src/db/`: Supabase repository. Service-role client for ingestion; anon client for read-only consumers.

For the architecture in detail (diagrams included) see
[../diagrams/ARCHITECTURE.md](../diagrams/ARCHITECTURE.md).

## Benchmark

The regex vs LLM bench is at `scripts/compare_extractors.py`. It runs
both extractors against one cached PDF on disk and writes
`output/extractor-comparison.json`:

```powershell
cd backend
..\.venv\Scripts\python.exe scripts\compare_extractors.py --filing 2023-00194787
```
