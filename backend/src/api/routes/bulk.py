"""Bulk lookup endpoint.

Accepts up to 100 queries (names or CBEs) and processes them with
bounded concurrency. Each query is independent: a single bad query
(404, ambiguous, network error) does not fail the request — it
becomes a ``BulkSearchResult`` with the appropriate ``status``.

Concurrency is capped by ``BULK_CONCURRENCY`` to avoid hammering
KBO / NBB / OpenAI. Five concurrent pipeline runs is a reasonable
default; raise it cautiously and only after profiling.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool

from src._enterprise_number import try_normalise
from src.api.deps import extractor_name, get_pipeline, get_repository
from src.api.schemas import (
    BulkSearchRequest,
    BulkSearchResponse,
    BulkSearchResult,
    CandidateMatch,
)
from src.db import EnrichmentRepository
from src.exceptions import (
    AmbiguousCompanyError,
    CompanyNotFoundError,
    EnrichmentError,
)
from src.pipeline import EnrichmentPipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/companies", tags=["companies", "bulk"])

BULK_CONCURRENCY = 5


@router.post("/bulk", response_model=BulkSearchResponse)
async def bulk_search(
    payload: BulkSearchRequest,
    pipeline: EnrichmentPipeline = Depends(get_pipeline),
    repo: Optional[EnrichmentRepository] = Depends(get_repository),
):
    """Resolve a list of queries in one request.

    Each query is handled exactly like ``/companies/search`` (cache
    lookup first when the query is a CBE; pipeline call on miss; save
    back). The whole request runs in parallel with a semaphore cap of
    :data:`BULK_CONCURRENCY` to keep the upstream services happy.
    """
    if not payload.queries:
        raise HTTPException(status_code=400, detail="queries must not be empty")

    semaphore = asyncio.Semaphore(BULK_CONCURRENCY)
    started = time.perf_counter()

    async def _one(q: str) -> BulkSearchResult:
        query = q.strip()
        if not query:
            return BulkSearchResult(
                query=q,
                status="error",
                error="empty query",
            )

        cbe = try_normalise(query)

        # Cache fast path
        if repo is not None and not payload.refresh and cbe is not None:
            try:
                cached = await run_in_threadpool(repo.get_report, cbe)
            except Exception as exc:
                logger.warning("Cache read failed for %s: %s", cbe, exc)
                cached = None
            if cached is not None and cached.statements:
                return BulkSearchResult(
                    query=query, status="ok", report=cached, from_cache=True
                )

        async with semaphore:
            try:
                report = await run_in_threadpool(pipeline.run, query)
            except AmbiguousCompanyError as exc:
                return BulkSearchResult(
                    query=query,
                    status="ambiguous",
                    candidates=[CandidateMatch(**c) for c in exc.candidates],
                )
            except CompanyNotFoundError as exc:
                return BulkSearchResult(query=query, status="not_found", error=str(exc))
            except EnrichmentError as exc:
                logger.exception("Pipeline failed for %r", query)
                return BulkSearchResult(query=query, status="error", error=str(exc))
            except Exception as exc:  # pragma: no cover — defensive
                logger.exception("Unexpected error for %r", query)
                return BulkSearchResult(query=query, status="error", error=str(exc))

        if repo is not None:
            try:
                await run_in_threadpool(
                    repo.save_report, report, extractor=extractor_name()
                )
            except Exception as exc:
                logger.warning(
                    "Failed to persist report for %s: %s",
                    report.company.enterprise_number,
                    exc,
                )

        return BulkSearchResult(query=query, status="ok", report=report, from_cache=False)

    results = await asyncio.gather(*(_one(q) for q in payload.queries))
    return BulkSearchResponse(
        results=results,
        completed_at=datetime.utcnow(),
        elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
    )
