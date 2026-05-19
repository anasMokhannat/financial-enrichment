"""FastAPI entry point.

Run with::

    uvicorn src.api.main:app --reload --port 8000

The frontend (Phase 4, Next.js) talks to this. CORS origins below
allow the standard Next.js dev server; extend the list for staging
and production via the ``CORS_ORIGINS`` env var (comma-separated).
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi_cache import FastAPICache
from fastapi_cache.backends.inmemory import InMemoryBackend
from fastapi_cache.decorator import cache

from src.api.deps import get_repository
from src.api.routes import bulk as bulk_routes
from src.api.routes import companies as company_routes
from src.api.schemas import HealthResponse, StatsResponse
from src.config import settings
from src.db import EnrichmentRepository

logger = logging.getLogger(__name__)


def _cors_origins() -> list[str]:
    """Parse the CORS_ORIGINS env var; fall back to the Next.js dev server."""
    raw = os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return [o.strip() for o in raw.split(",") if o.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Log capability state + initialise the HTTP-tier cache.

    Backend is :class:`fastapi_cache.backends.inmemory.InMemoryBackend`
    by default — single process, dict-with-TTL semantics, no external
    service needed. To scale beyond one node, swap to RedisBackend:

        from fastapi_cache.backends.redis import RedisBackend
        from redis import asyncio as aioredis
        redis = aioredis.from_url("redis://...")
        FastAPICache.init(RedisBackend(redis), prefix="lfe")

    Every read endpoint that is `@cache(...)`-decorated below will
    transparently use whichever backend is active here — no other
    code change needed.
    """
    FastAPICache.init(InMemoryBackend(), prefix="lfe")
    logger.info(
        "API starting · openai=%s supabase=%s nbb=%s · cache=in-memory",
        settings.has_openai_credentials,
        settings.has_supabase_credentials,
        settings.has_nbb_credentials,
    )
    yield
    await FastAPICache.clear()


# On Vercel monorepo routing the backend lives under /_/backend; the
# gateway strips that prefix before the request reaches us, so route
# matching is unchanged — but FastAPI still needs to know the public
# prefix so the OpenAPI schema and Swagger UI generate the right URLs.
# In local dev this stays empty.
_root_path = os.environ.get("FASTAPI_ROOT_PATH", "")

app = FastAPI(
    title="legal-financial-enrichment",
    version="0.1.0",
    summary="Belgian company enrichment: KBO + NBB + LLM extraction.",
    lifespan=lifespan,
    root_path=_root_path,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(company_routes.router)
app.include_router(bulk_routes.router)


@app.get("/health", response_model=HealthResponse, tags=["meta"])
async def health() -> HealthResponse:
    """Boot-time capability snapshot.

    Returns 200 regardless of which optional services are wired up;
    the response body tells the caller what's actually available.
    """
    return HealthResponse(
        services={
            "nbb": settings.has_nbb_credentials,
            "openai": settings.has_openai_credentials,
            "supabase": settings.has_supabase_credentials,
        }
    )


@app.post("/admin/cache/clear", tags=["meta"])
async def cache_clear(namespace: str | None = None) -> dict:
    """Drop the cache, optionally limited to one namespace.

    Useful in dev when you've changed schema and stale responses are
    sticking around. In production, prefer the namespaced invalidation
    that runs automatically on every write endpoint.
    """
    if namespace:
        cleared = await FastAPICache.clear(namespace=namespace)
    else:
        cleared = await FastAPICache.clear()
    return {"cleared": cleared, "namespace": namespace}


@app.get("/stats", response_model=StatsResponse, tags=["meta"])
@cache(expire=60, namespace="stats")
async def stats(
    repo: EnrichmentRepository | None = Depends(get_repository),
) -> StatsResponse:
    """Aggregate counts powering the Overview tiles.

    Backed by Supabase only — no upstream calls. Returns 503 when the
    DB isn't configured so the frontend can render an honest empty
    state rather than zeroes that look real.
    """
    if repo is None:
        raise HTTPException(
            status_code=503,
            detail="Supabase not configured; /stats requires the cache.",
        )

    companies = await run_in_threadpool(repo.count_companies)
    statements = await run_in_threadpool(repo.count_statements)
    latest = await run_in_threadpool(repo.latest_extraction_at)

    return StatsResponse(
        companies_cached=companies,
        filings_extracted=statements,
        last_extraction_at=latest,
    )
