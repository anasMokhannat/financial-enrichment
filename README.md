# legal-financial-enrichment

Belgian company enrichment: resolve a company name or CBE number to a
structured `CompanyFinancialReport` containing the legal profile (from
KBO) and the most recent annual filings with extracted financials
(from NBB CBSO, parsed by an OpenAI LLM extractor).

The repo splits into two top-level workspaces:

| Folder | What it is |
|---|---|
| [backend/](backend/) | Python · FastAPI service wrapping the enrichment pipeline · Supabase persistence |
| [frontend/](frontend/) | TypeScript · Next.js dashboard consuming the API |
| [diagrams/](diagrams/) | Single-file architecture diagram of the whole project |

Each side has its own README with setup and run instructions:

- [backend/README.md](backend/README.md) — Python venv, env vars, `uvicorn` command, Supabase migration.
- [frontend/README.md](frontend/README.md) — pnpm/npm install, dev server, env vars, design notes.
- [diagrams/ARCHITECTURE.md](diagrams/ARCHITECTURE.md) — five diagrams from system context down to the data model.

## Quick start

```powershell
# Terminal 1 — backend
cd backend
python -m venv .venv ; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # fill in keys
.\.venv\Scripts\uvicorn.exe src.api.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm install
copy .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Then open <http://localhost:3000> for the dashboard and
<http://localhost:8000/docs> for the API's Swagger UI.

## How the two sides talk to each other

```
┌───────────────────┐    HTTPS/CORS    ┌─────────────────────────┐
│  Next.js · /api/  │ ───────────────▶ │  FastAPI · /companies/  │
│  (frontend)       │                  │  (backend)              │
└───────────────────┘                  └─────────────────────────┘
                                                 │
                              ┌──────────────────┼──────────────────┐
                              ▼                  ▼                  ▼
                       KBO public        NBB CBSO API        OpenAI Chat
                       (HTML scrape)     (Subscription-Key)  (JSON schema)
                              │                  │                  │
                              └──────────────────┴──────────────────┘
                                                 │
                                                 ▼
                                          Supabase Postgres
                                          (cache · public read,
                                           service-role write)
```

The frontend never speaks directly to KBO/NBB/OpenAI/Supabase. All
upstream calls go through the FastAPI backend, which is the single
boundary that owns the third-party credentials.

## License and notes

- KBO public search prohibits bulk/automated reuse; the scraper does
  one-CBE-at-a-time lookups only.
- NBB Authentic Data Query requires a subscription. Request access via
  the [CBSO order form](https://www.nbb.be/en/central-balance-sheet-office/consultation/web-services).
- All monetary values are in EUR.
