"""Repository for cached commercial-fit analyses."""

from __future__ import annotations

import logging
from typing import Optional

from supabase import Client

from src.analysis import CommercialAnalysis

logger = logging.getLogger(__name__)


class AnalysisRepository:
    def __init__(self, client: Client) -> None:
        self._client = client

    def upsert(self, analysis: CommercialAnalysis) -> None:
        row = analysis.model_dump(mode="json", exclude_none=True)
        # Postgres ``text[]`` column expects a Python list, not a JSON
        # string; supabase-py round-trips JSON natively so the dump is
        # already in the right shape.
        self._client.table("commercial_analyses").upsert(
            row, on_conflict="enterprise_number"
        ).execute()

    def get(self, enterprise_number: str) -> Optional[CommercialAnalysis]:
        resp = (
            self._client.table("commercial_analyses")
            .select("*")
            .eq("enterprise_number", enterprise_number)
            .maybe_single()
            .execute()
        )
        if resp is None or not resp.data:
            return None
        return CommercialAnalysis(**resp.data)
