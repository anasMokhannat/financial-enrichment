"""Pydantic models for the commercial-fit analysis output."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


Verdict = Literal["strong", "stable", "watch", "risky", "avoid"]
"""Five-level commercial assessment.

- **strong**:  healthy, growing, low risk → extend favourable terms
- **stable**:  solid finances, no growth surprises → normal terms
- **watch**:   mixed signals or borderline metrics → standard caution
- **risky**:   material concerns (negative equity, sustained losses)
- **avoid**:   distress signals or insufficient data quality
"""

Confidence = Literal["high", "medium", "low"]
"""How much the analyzer trusts its own answer.

Driven by data availability, not by the verdict. A company with three
years of detailed filings and consistent identities = high. One year
of an abbreviated micro filing with missing ratios = low.
"""


class CommercialAnalysis(BaseModel):
    """Structured commercial-fit assessment of a company."""

    model_config = ConfigDict(populate_by_name=True)

    enterprise_number: str
    verdict: Verdict
    summary: str = Field(
        description="One- or two-sentence executive summary for a salesperson."
    )
    strengths: list[str] = Field(
        default_factory=list,
        description="Positive signals as short bullet phrases (max ~6 items).",
    )
    concerns: list[str] = Field(
        default_factory=list,
        description="Risk signals as short bullet phrases (max ~6 items).",
    )
    commercial_recommendation: str = Field(
        description="Concrete suggested action / credit posture, e.g. "
        "'Safe to extend net-30 terms up to €X.'",
    )
    confidence: Confidence
    confidence_score: Optional[int] = Field(
        default=None,
        ge=0,
        le=100,
        description=(
            "Numeric confidence 0–100 the analyzer assigns to its own verdict. "
            "Maps to the categorical `confidence` field on the same model: "
            ">=70 high, 40-69 medium, <40 low. None on rows created before "
            "the column was added."
        ),
    )
    confidence_factors: list[str] = Field(
        default_factory=list,
        description=(
            "Short bullet phrases explaining why the confidence is what it is "
            "(e.g. 'Only 1 filing year available', 'Balance-sheet identity "
            "holds across periods')."
        ),
    )

    # Audit metadata
    based_on_filing_refs: list[str] = Field(default_factory=list)
    model: Optional[str] = None
    generated_at: Optional[datetime] = None
