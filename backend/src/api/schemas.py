"""Request and response models for the FastAPI service.

Where the API shape and the domain shape match, we re-export the
domain model directly. New types are defined here only for the
API-specific concerns: ambiguous KBO matches (list of candidates),
bulk responses (per-query status), and freshness metadata.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from src.models import CompanyFinancialReport


class CandidateMatch(BaseModel):
    """One of several KBO matches when a name resolves ambiguously."""

    enterprise_number: str
    name: str
    address: Optional[str] = None


class CompanySearchResponse(BaseModel):
    """Result of GET /companies/search.

    Exactly one of ``report`` or ``candidates`` is populated:
    - ``report`` set when the query resolved to a single company.
    - ``candidates`` set when KBO returned multiple matches and the
      caller must pick one.
    """

    query: str
    report: Optional[CompanyFinancialReport] = None
    candidates: Optional[list[CandidateMatch]] = None
    from_cache: bool = Field(
        default=False,
        description="True if the report came from Supabase without running the pipeline.",
    )


class BulkSearchRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    queries: list[str] = Field(
        min_length=1,
        max_length=100,
        description="Up to 100 names or enterprise numbers. Each item is processed independently.",
    )
    refresh: bool = Field(
        default=False,
        description="If true, bypass Supabase cache and re-run the pipeline for every query.",
    )


class BulkSearchResult(BaseModel):
    query: str
    status: Literal["ok", "not_found", "ambiguous", "error"]
    report: Optional[CompanyFinancialReport] = None
    candidates: Optional[list[CandidateMatch]] = None
    from_cache: bool = False
    error: Optional[str] = None


class BulkSearchResponse(BaseModel):
    results: list[BulkSearchResult]
    completed_at: datetime
    elapsed_ms: float


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    services: dict[str, bool]


class CompanyListItem(BaseModel):
    """One row of the /companies index. A lighter projection of Company
    plus two pieces of metadata the list view needs (last refresh
    timestamp, statement count)."""

    enterprise_number: str
    name: Optional[str] = None
    trade_name: Optional[str] = None
    legal_form: Optional[str] = None
    status: Optional[str] = None
    dissolution_date: Optional[str] = None
    last_refreshed_at: Optional[datetime] = None
    statement_count: int = 0


class CompanyListResponse(BaseModel):
    items: list[CompanyListItem]
    total: int
    limit: int
    offset: int


class StatsResponse(BaseModel):
    """Aggregate numbers for the Overview tiles."""

    companies_cached: int
    filings_extracted: int
    last_extraction_at: Optional[datetime] = None
