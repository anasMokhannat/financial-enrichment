"""LLM-backed commercial-fit analysis of company financials.

Given a :class:`CompanyFinancialReport`, the analyzer produces a
short, structured assessment a salesperson can use to decide whether
to extend credit terms: a five-level verdict, an executive summary,
lists of strengths and concerns, a concrete commercial
recommendation, and a confidence flag scaled to how much usable data
was available.

The analyzer is deliberately one-shot, single-model, and cheap — the
output is meant to inform a human, not replace one. Run it once per
company, cache the result in Supabase, regenerate on demand.
"""

from .analyzer import CommercialAnalyzer
from .models import CommercialAnalysis, Verdict, Confidence

__all__ = [
    "CommercialAnalyzer",
    "CommercialAnalysis",
    "Verdict",
    "Confidence",
]
