"""FastAPI dependency injectors.

The pipeline and repository are built once at process start and shared
across requests. The repository wraps a Supabase client that maintains
its own HTTP connection pool, so a singleton is the right shape.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from src.analysis import CommercialAnalyzer
from src.analysis.analyzer import AnalysisUnavailableError
from src.config import settings
from src.db import (
    AnalysisRepository,
    EnrichmentRepository,
    SupabaseUnavailableError,
    get_service_client,
)
from src.pipeline import EnrichmentPipeline, PipelineConfig


@lru_cache(maxsize=1)
def get_pipeline() -> EnrichmentPipeline:
    return EnrichmentPipeline(config=PipelineConfig(filings_to_read=5))


@lru_cache(maxsize=1)
def get_repository() -> Optional[EnrichmentRepository]:
    """Return an :class:`EnrichmentRepository` or ``None`` when Supabase isn't configured.

    Routes treat a missing repository as "cache disabled" — they still
    work, they just run the pipeline on every request and don't persist
    the results.
    """
    if not settings.has_supabase_credentials:
        return None
    try:
        return EnrichmentRepository(get_service_client())
    except SupabaseUnavailableError:
        return None


def extractor_name() -> str:
    """Label written to ``financial_statements.extractor`` so we can
    later filter rows by which extractor produced them."""
    if settings.has_openai_credentials:
        return f"llm-{settings.openai_model}"
    return "regex"


@lru_cache(maxsize=1)
def get_analyzer() -> Optional[CommercialAnalyzer]:
    """Return a :class:`CommercialAnalyzer` or ``None`` when OpenAI isn't
    configured. Routes treat a missing analyzer as 503-not-available."""
    if not settings.has_openai_credentials:
        return None
    try:
        return CommercialAnalyzer()
    except AnalysisUnavailableError:
        return None


@lru_cache(maxsize=1)
def get_analysis_repository() -> Optional[AnalysisRepository]:
    if not settings.has_supabase_credentials:
        return None
    try:
        return AnalysisRepository(get_service_client())
    except SupabaseUnavailableError:
        return None
