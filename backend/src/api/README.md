# API

FastAPI service wrapping the enrichment pipeline. The Next.js
frontend (Phase 4) is the primary consumer; the API is also fine to
hit from `curl`, Insomnia, or anything else that speaks JSON.

## Run

```powershell
.\.venv\Scripts\uvicorn.exe src.api.main:app --reload --port 8000
```

Interactive docs are available at:

- Swagger UI: <http://localhost:8000/docs>
- ReDoc: <http://localhost:8000/redoc>
- OpenAPI JSON: <http://localhost:8000/openapi.json>

## Environment

Reuses the same `.env` as the CLI / dashboard. Optional extra:

```
CORS_ORIGINS=http://localhost:3000,https://your-domain.example
```

If `SUPABASE_*` is unset, the API still works — it just runs the
pipeline on every request and doesn't persist results. The `legal`,
`filings`, and `statements` endpoints return 503 in that case (they
are cache-only by design).

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Service-availability snapshot. |
| GET | `/companies/search?q=<name or CBE>&refresh=false` | Resolve a query to a `CompanyFinancialReport`. 409 on ambiguous name; 404 on unknown. |
| GET | `/companies/{cbe}?refresh=false` | Same as `search` but for direct CBE GETs. 400 on bad format. |
| POST | `/companies/{cbe}/refresh` | Force a fresh pipeline run and update Supabase. |
| GET | `/companies/{cbe}/legal` | Cached legal profile (Company + NACE + functions). 404 if not cached. |
| GET | `/companies/{cbe}/filings` | Cached `FilingReference[]`. |
| GET | `/companies/{cbe}/statements` | Cached `FinancialStatement[]`. |
| POST | `/companies/bulk` | Up to 100 queries in one request, capped at 5 concurrent pipeline runs. |

## Examples

Single lookup by name (cache-first):

```powershell
curl "http://localhost:8000/companies/search?q=Colruyt Group SA"
```

Single lookup by CBE, force fresh:

```powershell
curl "http://localhost:8000/companies/0400378485?refresh=true"
```

Ambiguous name → 409 with candidates the frontend can render in a
dropdown:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "detail": {
    "code": "ambiguous_match",
    "message": "12 KBO matches for 'flugia'; refine the query.",
    "candidates": [
      {"enterprise_number": "0712345678", "name": "FLUGIA BV"},
      {"enterprise_number": "0823456789", "name": "FLUGIA SOLUTIONS"}
    ]
  }
}
```

Bulk:

```powershell
curl -X POST http://localhost:8000/companies/bulk `
  -H "Content-Type: application/json" `
  -d '{"queries":["0400378485","Colruyt Group SA","0478358468"]}'
```

Response:

```json
{
  "results": [
    {"query":"0400378485","status":"ok","report":{...},"from_cache":true},
    {"query":"Colruyt Group SA","status":"ok","report":{...},"from_cache":false},
    {"query":"0478358468","status":"not_found","error":"NBB returned no filings"}
  ],
  "completed_at": "2026-05-15T11:32:18.012Z",
  "elapsed_ms": 4218.7
}
```

## Cache semantics

- A CBE query checks Supabase first and serves cached data if
  `financial_statements` are present (we treat "no statements" as a
  partial cache that's not worth serving).
- A name query always goes through the pipeline because KBO must
  resolve the name to a CBE before we can look anything up.
- `refresh=true` skips the cache lookup but still writes the fresh
  result back.
- The `legal`, `filings`, `statements` endpoints are cache-only — they
  never call the pipeline. Hit `search` or `{cbe}` first if the data
  isn't there.
