"""OpenAI-backed commercial-fit analyzer.

Reuses the same OpenAI client + structured-output pattern as the
LLM extractor, but with a much smaller input (the already-extracted
``CompanyFinancialReport``) and a different system prompt.

Cost is well under $0.01 per call on gpt-4o-mini for typical inputs.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from openai import OpenAI

from src._timing import timed
from src.config import settings as default_settings
from src.exceptions import EnrichmentError
from src.models import CompanyFinancialReport

from .models import CommercialAnalysis

logger = logging.getLogger(__name__)


class AnalysisUnavailableError(EnrichmentError):
    """The analyzer can't run — usually because OpenAI isn't configured."""


_SYSTEM_PROMPT = """You are a senior B2B credit analyst.

You receive structured financial data for a Belgian company (legal
profile + one or more years of extracted annual statements) and you
write a short commercial-fit assessment for a salesperson deciding
whether to extend credit terms to this company.

Your output must be a single JSON object matching the response schema.
Keep prose tight — strengths and concerns are short bullet phrases,
not paragraphs. The summary is one or two sentences a busy salesperson
will read in seconds.

Verdict ladder, pick the highest that the data supports:
- "strong": growing revenue, positive net profit across years, strong
  liquidity (current ratio >= 1.5), low leverage (D/E < 1), no
  dissolution / qualifying-opinion red flags. Recommend favourable terms.
- "stable": positive equity, profitable or near-break-even, current
  ratio >= 1, no acute red flags. Standard B2B terms are appropriate.
- "watch": one or two material concerns (e.g. declining revenue, thin
  margins, current ratio < 1, modest negative result). Proceed with
  normal caution; consider a credit limit.
- "risky": multiple material concerns OR a single severe one (sustained
  losses, equity erosion, current ratio << 1, debt/equity >> 2,
  reorganisation indicators). Tighten terms (advance payment, partial
  prepayment, lower limits).
- "avoid": dissolution, negative or near-zero equity, repeated losses
  eroding the balance sheet, or so little data the picture can't be
  formed. Recommend against open credit; insist on advance payment.

Confidence — two complementary outputs, kept in lock-step.

The categorical `confidence` value:
- "high":   3+ years of consistent statements with most ratios populated.
- "medium": 1-2 years OR several ratios missing.
- "low":    Single short-form filing, identities don't balance, or
            mostly empty data. Lower the verdict accordingly.

The numeric `confidence_score` (integer 0-100) anchors the same
judgement on a 100-point scale:
- 90-100: 3+ years of consistent data, all balance-sheet identities
          hold, every key ratio computable, no ambiguous signals.
- 70-89:  2 years of data; most ratios available; no major gaps.
- 50-69:  1 year of full data OR mixed signals across periods OR
          some balance-sheet legs missing.
- 30-49:  Sparse data (one short-form filing) OR contradictory
          signals (e.g. positive equity but persistent losses) OR
          identities don't balance cleanly.
- 0-29:   Data quality so poor the verdict is essentially a guess.

The numeric and categorical confidence MUST agree:
  score >= 70 → categorical "high"
  40 <= score < 70 → "medium"
  score < 40 → "low"

Populate `confidence_factors` with 2-4 short phrases explaining
*why* the confidence is what it is, e.g. "Only one fiscal year on
record", "Balance sheet balances within €1", "Inventory missing —
quick ratio degraded to current ratio".

Be specific in the commercial_recommendation — name the terms or
credit posture you'd suggest. Reference actual numbers from the data
where they make the point ("Revenue down 27% YoY to €1.46M", not
"revenue is declining").

Currency throughout is EUR.
"""


_RESPONSE_SCHEMA: dict[str, Any] = {
    "name": "CommercialAnalysis",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "verdict",
            "summary",
            "strengths",
            "concerns",
            "commercial_recommendation",
            "confidence",
            "confidence_score",
            "confidence_factors",
        ],
        "properties": {
            "verdict": {
                "type": "string",
                "enum": ["strong", "stable", "watch", "risky", "avoid"],
            },
            "summary": {"type": "string"},
            "strengths": {
                "type": "array",
                "items": {"type": "string"},
            },
            "concerns": {
                "type": "array",
                "items": {"type": "string"},
            },
            "commercial_recommendation": {"type": "string"},
            "confidence": {
                "type": "string",
                "enum": ["high", "medium", "low"],
            },
            "confidence_score": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
                "description": "0-100 scale; aligns with categorical confidence.",
            },
            "confidence_factors": {
                "type": "array",
                "items": {"type": "string"},
                "description": "2-4 short reasons explaining the confidence level.",
            },
        },
    },
}


class CommercialAnalyzer:
    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> None:
        api_key = api_key or default_settings.openai_api_key
        if not api_key:
            raise AnalysisUnavailableError(
                "OPENAI_API_KEY is not set. The commercial analyzer "
                "requires OpenAI."
            )
        self._client = OpenAI(api_key=api_key)
        self._model = model or default_settings.openai_model

    def analyze(self, report: CompanyFinancialReport) -> CommercialAnalysis:
        if not report.statements:
            # No statements = no analysis. Caller decides whether to
            # surface this as a 404 or show "insufficient data" in the UI.
            raise AnalysisUnavailableError(
                f"No financial statements available for "
                f"{report.company.enterprise_number}; cannot analyze."
            )

        with timed(f"analysis.openai_call[{report.company.enterprise_number}]"):
            user_payload = _serialise_for_prompt(report)
            response = self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_payload},
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": _RESPONSE_SCHEMA,
                },
                temperature=0,
            )
        content = response.choices[0].message.content
        if not content:
            raise AnalysisUnavailableError("OpenAI returned an empty analysis.")

        payload = json.loads(content)
        return CommercialAnalysis(
            enterprise_number=report.company.enterprise_number,
            verdict=payload["verdict"],
            summary=payload["summary"],
            strengths=list(payload.get("strengths") or []),
            concerns=list(payload.get("concerns") or []),
            commercial_recommendation=payload["commercial_recommendation"],
            confidence=payload["confidence"],
            confidence_score=payload.get("confidence_score"),
            confidence_factors=list(payload.get("confidence_factors") or []),
            based_on_filing_refs=[s.reference for s in report.statements],
            model=self._model,
            generated_at=datetime.now(timezone.utc),
        )


def _serialise_for_prompt(report: CompanyFinancialReport) -> str:
    """Render the report as compact JSON the model can read cheaply.

    We strip null fields per-statement so the model doesn't waste
    attention on absent data. NACE codes and director lists are kept
    short — just code + description and role + holder name — because
    the analyzer doesn't need the full audit trail.
    """
    company = report.company
    statements = sorted(
        report.statements,
        key=lambda s: s.fiscal_year or 0,
        reverse=True,
    )

    payload = {
        "company": {
            "enterprise_number": company.enterprise_number,
            "name": company.name,
            "trade_name": company.trade_name,
            "legal_form": company.legal_form,
            "status": company.status,
            "start_date": _as_iso(company.start_date),
            "dissolution_date": _as_iso(company.dissolution_date),
            "vat_subject": company.vat_subject,
            "nace_codes": [
                {"code": n.code, "description": n.description}
                for n in company.nace_codes[:6]
            ],
            "n_directors": len(company.functions),
        },
        "statements": [_compact_statement(s) for s in statements],
    }
    return json.dumps(payload, ensure_ascii=False, default=str)


def _compact_statement(s) -> dict:
    """One statement → small dict with only non-null fields."""
    fields = [
        "fiscal_year",
        "currency",
        "revenue",
        "operating_profit",
        "net_profit",
        "total_assets",
        "fixed_assets",
        "current_assets",
        "total_equity",
        "total_liabilities",
        "long_term_debt",
        "short_term_debt",
        "cash_and_equivalents",
        "inventory",
        "depreciation",
        "employees_fte",
    ]
    out: dict[str, Any] = {}
    for f in fields:
        v = getattr(s, f, None)
        if v is None:
            continue
        out[f] = _jsonable(v)
    return out


def _jsonable(v: Any) -> Any:
    if isinstance(v, Decimal):
        return str(v)
    return v


def _as_iso(d) -> Optional[str]:
    return d.isoformat() if d is not None else None
