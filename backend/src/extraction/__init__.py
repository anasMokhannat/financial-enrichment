"""Financial-statement extractors.

Three implementations, ordered by accuracy:

1. :class:`XbrlExtractor` — fetches the XBRL representation of a
   filing and reads tagged Belgian-GAAP facts. Belgian filings have
   machine-readable XBRL since 2007, so this should hit on virtually
   every modern VOL filing. Deterministic — no LLM inference required.
2. :class:`LLMExtractor` — sends segmented PDF text to OpenAI with a
   strict JSON-schema response. Fallback when XBRL is unavailable
   (older filings, missing endpoint, parse errors).
3. :class:`FinancialExtractor` — regex/heading-code scanner. Lowest
   accuracy on VOL filings but no API key required.

:func:`build_extractor` returns a :class:`ChainExtractor` that tries
each in order; the first to produce a usable :class:`FinancialStatement`
wins. The pipeline never knows which extractor produced a row — only
the ``source`` field on :class:`FinancialStatement` reveals it.
"""

from typing import Optional

from src.models import FilingReference, FinancialStatement
from src.nbb.client import NBBClient

from .extractor import FinancialExtractor
from .llm_extractor import LLMExtractor
from .xbrl_extractor import XbrlExtractor


class ChainExtractor:
    """Try each extractor in order; return the first useful result.

    "Useful" means at least :data:`MIN_FIELDS_FOR_WIN` numeric fields
    are populated. A single field alone could be a false positive —
    the XBRL extractor used to mis-map a context id like ``c70`` to
    ``revenue`` on dimensional filings where context names happen to
    contain digit runs that match NBB heading codes. Requiring a
    minimum number of fields gives the next extractor in the chain
    a chance to do better on those filings.

    The last partial result is kept as a last-resort fallback in case
    every extractor fails to clear the threshold (the caller still
    gets something to display).
    """

    def __init__(self, extractors: list) -> None:
        self._extractors = extractors

    def extract(
        self, enterprise_number: str, ref: FilingReference
    ) -> Optional[FinancialStatement]:
        last: Optional[FinancialStatement] = None
        for extractor in self._extractors:
            stmt = extractor.extract(enterprise_number, ref)
            if stmt is None:
                continue
            if _has_useful_values(stmt):
                return stmt
            last = stmt
        return last


MIN_FIELDS_FOR_WIN = 3
"""Minimum populated numeric fields for an extractor to be trusted.

Three is the smallest number that can't be reached by a single
coincidental digit match (which can produce 1 field) but is still
low enough that small filings (M-models, ASBL with no inventory, etc.)
which legitimately have only a handful of values still pass.
"""

_NUMERIC_FIELDS = (
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
)


def _has_useful_values(stmt: FinancialStatement) -> bool:
    populated = sum(
        1 for f in _NUMERIC_FIELDS if getattr(stmt, f, None) is not None
    )
    return populated >= MIN_FIELDS_FOR_WIN


def build_extractor(nbb_client: NBBClient) -> ChainExtractor:
    """Return a chain extractor matching the current environment.

    Order: XBRL → LLM (if API key configured) → regex.
    Regex is always the terminal fallback so the pipeline can produce
    *something* even when XBRL fails and there's no API key.
    """
    # Local import: avoids a circular config <-> extraction at module load.
    from src.config import settings

    chain: list = [XbrlExtractor(nbb_client)]
    if settings.has_openai_credentials:
        chain.append(LLMExtractor(nbb_client))
    chain.append(FinancialExtractor(nbb_client))

    return ChainExtractor(chain)


__all__ = [
    "ChainExtractor",
    "FinancialExtractor",
    "LLMExtractor",
    "XbrlExtractor",
    "build_extractor",
]
