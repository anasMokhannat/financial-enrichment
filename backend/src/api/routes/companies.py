"""Single-company endpoints.

All endpoints are async wrappers; the synchronous pipeline call is
offloaded to FastAPI's threadpool so the event loop stays free for
concurrent requests.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi_cache import FastAPICache
from fastapi_cache.decorator import cache

from src._enterprise_number import try_normalise
from src.analysis import CommercialAnalysis, CommercialAnalyzer
from src.analysis.analyzer import AnalysisUnavailableError
from src.api.deps import (
    extractor_name,
    get_analysis_repository,
    get_analyzer,
    get_pipeline,
    get_repository,
)
from src.api.schemas import (
    CandidateMatch,
    CompanyListItem,
    CompanyListResponse,
    CompanySearchResponse,
)
from src.db import AnalysisRepository, EnrichmentRepository
from src.exceptions import (
    AmbiguousCompanyError,
    CompanyNotFoundError,
    EnrichmentError,
)
from src.models import CompanyFinancialReport
from src.pipeline import EnrichmentPipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/companies", tags=["companies"])


# All cache namespaces that depend on per-company state. When a write
# happens (refresh, fresh search hitting the pipeline) we wipe each so
# the next read serves fresh data. Namespace-level clears are coarser
# than they need to be (drop all companies, not just one CBE), but the
# repopulation cost is negligible — one Supabase query per route.
_COMPANY_CACHE_NAMESPACES = (
    "stats",
    "companies-list",
    "company",
    "company-legal",
    "company-filings",
    "company-statements",
)


async def _invalidate_company_caches() -> None:
    for ns in _COMPANY_CACHE_NAMESPACES:
        try:
            await FastAPICache.clear(namespace=ns)
        except Exception:
            # Cache invalidation failures must never break a write. Log
            # and move on; the entries will expire on their own TTLs.
            logger.exception("Cache invalidation failed for namespace %s", ns)


async def _run_pipeline(
    pipeline: EnrichmentPipeline,
    query: str,
    *,
    filings: Optional[int] = None,
) -> CompanyFinancialReport:
    """Bridge the sync pipeline into an async route.

    KBO ambiguity and not-found surface as typed exceptions in the
    pipeline; we translate them into HTTPException for FastAPI.
    """
    def _invoke():
        return pipeline.run(query, filings_to_read=filings)

    try:
        return await run_in_threadpool(_invoke)
    except AmbiguousCompanyError as exc:
        # 409 is the cleanest HTTP signal for "your input was understood
        # but resolves to several entities — pick one." The candidates
        # ride along in the body via a custom exception handler in main.py.
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ambiguous_match",
                "message": str(exc),
                "candidates": exc.candidates,
            },
        ) from exc
    except CompanyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except EnrichmentError as exc:
        logger.exception("Pipeline failed for %r", query)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("", response_model=CompanyListResponse)
@cache(expire=30, namespace="companies-list")
async def list_companies(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    repo: Optional[EnrichmentRepository] = Depends(get_repository),
):
    """Paginated index of every company in Supabase.

    Cache-only — never runs the pipeline. Returns 503 when Supabase
    isn't configured because there's nothing to enumerate without it.
    """
    if repo is None:
        raise HTTPException(
            status_code=503,
            detail="Supabase not configured; companies list requires the cache.",
        )

    rows, total = await run_in_threadpool(
        repo.list_companies, limit=limit, offset=offset
    )
    enterprise_numbers = [r["enterprise_number"] for r in rows]
    counts = await run_in_threadpool(
        repo.statement_counts_by_enterprise, enterprise_numbers
    )

    items = [
        CompanyListItem(
            enterprise_number=row["enterprise_number"],
            name=row.get("name"),
            trade_name=row.get("trade_name"),
            legal_form=row.get("legal_form"),
            status=row.get("status"),
            dissolution_date=row.get("dissolution_date"),
            last_refreshed_at=row.get("last_refreshed_at"),
            statement_count=counts.get(row["enterprise_number"], 0),
        )
        for row in rows
    ]
    return CompanyListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/search", response_model=CompanySearchResponse)
async def search_companies(
    q: str = Query(..., min_length=1, description="Company name or 10-digit CBE."),
    refresh: bool = Query(False, description="Bypass Supabase cache and re-run the pipeline."),
    filings: Optional[int] = Query(
        None,
        ge=1,
        le=20,
        description="How many of the most recent filings to extract. Default uses pipeline config.",
    ),
    pipeline: EnrichmentPipeline = Depends(get_pipeline),
    repo: Optional[EnrichmentRepository] = Depends(get_repository),
):
    """Resolve a name or CBE to a CompanyFinancialReport.

    Cache strategy:
    1. If *q* is a CBE and ``refresh=false`` and Supabase is configured,
       try to serve from the cache. The ``filings`` param is ignored on
       a cache hit (we return everything that's already in the DB).
    2. Otherwise (or on cache miss) run the pipeline. KBO ambiguous
       matches become a ``409`` with the candidates in the body.
    3. Persist the result back to Supabase if available.
    """
    query = q.strip()
    cbe = try_normalise(query)

    # 1. Cache lookup
    if repo is not None and not refresh and cbe is not None:
        cached = await run_in_threadpool(repo.get_report, cbe)
        if cached is not None and cached.statements:
            return CompanySearchResponse(query=query, report=cached, from_cache=True)

    # 2. Run pipeline
    report = await _run_pipeline(pipeline, query, filings=filings)

    # 3. Save back if Supabase is configured
    if repo is not None:
        try:
            await run_in_threadpool(repo.save_report, report, extractor=extractor_name())
        except Exception as exc:
            logger.warning("Failed to persist report for %s: %s",
                           report.company.enterprise_number, exc)
        else:
            await _invalidate_company_caches()

    return CompanySearchResponse(query=query, report=report, from_cache=False)


@router.get("/{cbe}", response_model=CompanyFinancialReport)
@cache(expire=300, namespace="company")
async def get_company(
    cbe: str,
    refresh: bool = Query(False),
    filings: Optional[int] = Query(None, ge=1, le=20),
    pipeline: EnrichmentPipeline = Depends(get_pipeline),
    repo: Optional[EnrichmentRepository] = Depends(get_repository),
):
    """Fetch a company by CBE. Mirrors /search but for direct GETs."""
    cbe_norm = try_normalise(cbe)
    if cbe_norm is None:
        raise HTTPException(status_code=400, detail=f"Not a valid CBE: {cbe!r}")

    if repo is not None and not refresh:
        cached = await run_in_threadpool(repo.get_report, cbe_norm)
        if cached is not None and cached.statements:
            return cached

    report = await _run_pipeline(pipeline, cbe_norm, filings=filings)
    if repo is not None:
        try:
            await run_in_threadpool(repo.save_report, report, extractor=extractor_name())
        except Exception as exc:
            logger.warning("Failed to persist report for %s: %s", cbe_norm, exc)
        else:
            await _invalidate_company_caches()
    return report


@router.post("/{cbe}/refresh", response_model=CompanyFinancialReport)
async def refresh_company(
    cbe: str,
    filings: Optional[int] = Query(None, ge=1, le=20),
    pipeline: EnrichmentPipeline = Depends(get_pipeline),
    repo: Optional[EnrichmentRepository] = Depends(get_repository),
):
    """Force a fresh pipeline run for *cbe* and update Supabase."""
    cbe_norm = try_normalise(cbe)
    if cbe_norm is None:
        raise HTTPException(status_code=400, detail=f"Not a valid CBE: {cbe!r}")

    report = await _run_pipeline(pipeline, cbe_norm, filings=filings)
    if repo is not None:
        try:
            await run_in_threadpool(repo.save_report, report, extractor=extractor_name())
        except Exception as exc:
            logger.warning("Failed to persist refreshed report for %s: %s",
                           cbe_norm, exc)

    # The report just changed — wipe every cache namespace that could
    # have a stale copy. Namespace-level clears are coarser than they
    # need to be (they drop all CBEs, not just this one), but the
    # repopulation cost is negligible (one Supabase select per route).
    await _invalidate_company_caches()
    return report


@router.get("/{cbe}/legal", tags=["companies", "legal"])
@cache(expire=300, namespace="company-legal")
async def get_legal_profile(
    cbe: str,
    repo: Optional[EnrichmentRepository] = Depends(get_repository),
    pipeline: EnrichmentPipeline = Depends(get_pipeline),
):
    """Just the legal-profile slice: company info, NACE codes, functions.

    Reads from Supabase only — does not run the pipeline. If the
    company isn't cached, returns 404 (callers should hit /search or
    /{cbe} first to populate the cache).
    """
    cbe_norm = try_normalise(cbe)
    if cbe_norm is None:
        raise HTTPException(status_code=400, detail=f"Not a valid CBE: {cbe!r}")

    if repo is None:
        raise HTTPException(
            status_code=503,
            detail="Supabase not configured; legal profile is cache-only.",
        )
    company = await run_in_threadpool(repo.get_company, cbe_norm)
    if company is None:
        raise HTTPException(status_code=404, detail=f"No cached company for CBE {cbe_norm}.")
    return company


@router.get("/{cbe}/filings", tags=["companies", "filings"])
@cache(expire=300, namespace="company-filings")
async def get_filings(
    cbe: str,
    repo: Optional[EnrichmentRepository] = Depends(get_repository),
):
    """Filing references for the company (cached only)."""
    cbe_norm = try_normalise(cbe)
    if cbe_norm is None:
        raise HTTPException(status_code=400, detail=f"Not a valid CBE: {cbe!r}")
    if repo is None:
        raise HTTPException(status_code=503, detail="Supabase not configured.")
    return await run_in_threadpool(repo.get_filings, cbe_norm)


@router.get("/{cbe}/statements", tags=["companies", "financials"])
@cache(expire=300, namespace="company-statements")
async def get_statements(
    cbe: str,
    repo: Optional[EnrichmentRepository] = Depends(get_repository),
):
    """Financial statements for the company (cached only)."""
    cbe_norm = try_normalise(cbe)
    if cbe_norm is None:
        raise HTTPException(status_code=400, detail=f"Not a valid CBE: {cbe!r}")
    if repo is None:
        raise HTTPException(status_code=503, detail="Supabase not configured.")
    return await run_in_threadpool(repo.get_statements, cbe_norm)


# ── Commercial-fit analysis ────────────────────────────────────────────

@router.get(
    "/{cbe}/analysis",
    response_model=CommercialAnalysis,
    tags=["companies", "analysis"],
)
@cache(expire=600, namespace="company-analysis")
async def get_analysis(
    cbe: str,
    repo: Optional[AnalysisRepository] = Depends(get_analysis_repository),
):
    """Return the cached commercial-fit analysis, or 404 if not generated yet."""
    cbe_norm = try_normalise(cbe)
    if cbe_norm is None:
        raise HTTPException(status_code=400, detail=f"Not a valid CBE: {cbe!r}")
    if repo is None:
        raise HTTPException(
            status_code=503,
            detail="Supabase not configured; analyses are stored there.",
        )
    analysis = await run_in_threadpool(repo.get, cbe_norm)
    if analysis is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No analysis cached for {cbe_norm}. POST /companies/{cbe_norm}/analyze "
                "to generate one."
            ),
        )
    return analysis


@router.post(
    "/{cbe}/analyze",
    response_model=CommercialAnalysis,
    tags=["companies", "analysis"],
)
async def generate_analysis(
    cbe: str,
    analyzer: Optional[CommercialAnalyzer] = Depends(get_analyzer),
    enrichment: Optional[EnrichmentRepository] = Depends(get_repository),
    analysis_repo: Optional[AnalysisRepository] = Depends(get_analysis_repository),
):
    """Run the LLM commercial-fit analyzer against the cached report and persist.

    Reads the company's :class:`CompanyFinancialReport` from Supabase
    (the analyzer doesn't re-run the pipeline). Returns 404 if the
    company isn't enriched yet — caller should hit ``/search`` or
    ``/{cbe}/refresh`` first to populate the cache.
    """
    cbe_norm = try_normalise(cbe)
    if cbe_norm is None:
        raise HTTPException(status_code=400, detail=f"Not a valid CBE: {cbe!r}")
    if analyzer is None:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY not configured; the analyzer is unavailable.",
        )
    if enrichment is None or analysis_repo is None:
        raise HTTPException(
            status_code=503,
            detail="Supabase not configured; cannot read source data or persist analysis.",
        )

    report = await run_in_threadpool(enrichment.get_report, cbe_norm)
    if report is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No cached company report for {cbe_norm}. Search/refresh it first."
            ),
        )

    try:
        analysis = await run_in_threadpool(analyzer.analyze, report)
    except AnalysisUnavailableError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Commercial analyzer failed for %s", cbe_norm)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        await run_in_threadpool(analysis_repo.upsert, analysis)
    except Exception as exc:
        logger.warning("Failed to persist analysis for %s: %s", cbe_norm, exc)

    # New analysis on file — drop the cached read for analyses so the
    # next GET serves the fresh row.
    await FastAPICache.clear(namespace="company-analysis")
    return analysis
