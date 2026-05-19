"""LLM-backed financial extractor (OpenAI).

Why a second extractor?

The regex-based scanner in :mod:`src.extraction.extractor` matches NBB
heading codes against numeric tokens on the same line. That works on
abbreviated/micro-schema filings where rows are short and tabular, but
falls apart on full-schema (VOL) filings where codes are followed by
footnote references, section markers, or column headers before the
actual EUR value. See ``output/extraction-sample.json`` for an example
where the regex extractor caught ``revenue=8`` from a 122-page Umicore
filing instead of the real turnover figure.

This module sends the pdfplumber-extracted text to an OpenAI chat model
with a strict JSON-schema response format, asking it to return the
exact :class:`FinancialStatement` fields. The schema is enforced
server-side so the response is guaranteed to be valid JSON shaped like
the model — we just round-trip it through Pydantic.
"""

from __future__ import annotations

import json
import logging
from decimal import Decimal
from typing import Optional

from openai import OpenAI

from src._timing import timed
from src.config import settings as default_settings
from src.exceptions import FinancialExtractionError
from src.models import FilingFormat, FilingReference, FinancialStatement
from src.nbb.client import NBBClient

from ._tokens import count_tokens, truncate_to_token_budget
from .extractor import _pdf_to_text
from .page_segmenter import select_financial_text

logger = logging.getLogger(__name__)

# OpenAI's "json_schema" structured-output mode requires every property to
# be listed in `required` and `additionalProperties: false` everywhere.
# Nullable fields use the array-of-types form (e.g. `["number", "null"]`).
# We hand-write this schema instead of round-tripping from Pydantic because
# Pydantic's generated schema includes constructs OpenAI's strict mode
# rejects (anyOf, $ref to nullable, etc.).
_NUMERIC_NULLABLE = {"type": ["number", "null"]}

_RESPONSE_SCHEMA = {
    "name": "FinancialStatement",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": [
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
        ],
        "properties": {
            "revenue": _NUMERIC_NULLABLE,
            "operating_profit": _NUMERIC_NULLABLE,
            "net_profit": _NUMERIC_NULLABLE,
            "total_assets": _NUMERIC_NULLABLE,
            "fixed_assets": _NUMERIC_NULLABLE,
            "current_assets": _NUMERIC_NULLABLE,
            "total_equity": _NUMERIC_NULLABLE,
            "total_liabilities": _NUMERIC_NULLABLE,
            "long_term_debt": _NUMERIC_NULLABLE,
            "short_term_debt": _NUMERIC_NULLABLE,
            "cash_and_equivalents": _NUMERIC_NULLABLE,
            "inventory": _NUMERIC_NULLABLE,
            "depreciation": _NUMERIC_NULLABLE,
            "employees_fte": _NUMERIC_NULLABLE,
        },
    },
}

_SYSTEM_PROMPT = """You extract financial values from Belgian NBB annual filings.

The text you receive is the pdfplumber dump of a single filing in one of \
the standard NBB schemas (M-app, VKT-kap, VOL-kap, C-ASBL, CONSO). Find \
the values for each requested field for the CURRENT fiscal year only \
(NOT the comparative prior-year column).

Rules:
- All values are in EUR. NBB filings often report thousands (e.g. "1.234.567" \
in the text may already be the full EUR amount — read the column header / unit \
indicator at the top of the page to decide).
- Belgian number format uses "." as thousands separator and "," as decimal \
separator (e.g. "1.234.567,89" = 1234567.89). Parse accordingly.
- Each field maps to one NBB code (sometimes alternatives):
    revenue              -> "70" (Net turnover / Omzet / Chiffre d'affaires)
    operating_profit     -> "9901"
    net_profit           -> "9904" (Profit/loss for the period)
    total_assets         -> "20/58"
    fixed_assets         -> "20/28" or "21/28"
    current_assets       -> "29/58"
    total_equity         -> "10/15"
    total_liabilities    -> "17/49" or "16"
    long_term_debt       -> "17" (Amounts payable after one year)
    short_term_debt      -> "42/48" (Amounts payable within one year)
    cash_and_equivalents -> "54/58"
    inventory            -> "3" or "30/36" (Stocks and contracts in progress)
    depreciation         -> "630"
    employees_fte        -> "9087" (Average headcount in FTE)
- Use null for any field that is genuinely absent from the filing (e.g. a \
service company with no inventory line; an abbreviated schema with no \
depreciation breakdown). Do NOT guess or pull values from comparative \
prior-year columns.
- If two columns appear ("Boekjaar" and "Vorig boekjaar" / "Exercice" and \
"Exercice précédent"), use Boekjaar / current year only.
"""


class LLMExtractor:
    """OpenAI-backed alternative to :class:`FinancialExtractor`.

    Same public interface as the regex extractor, so a benchmark harness
    can swap them transparently.
    """

    def __init__(
        self,
        nbb_client: NBBClient,
        *,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        max_input_tokens: Optional[int] = None,
        safety_margin_tokens: Optional[int] = None,
    ) -> None:
        api_key = api_key or default_settings.openai_api_key
        if not api_key:
            raise FinancialExtractionError(
                "OPENAI_API_KEY is not set. Add it to your .env to use LLMExtractor."
            )
        self._nbb = nbb_client
        self._model = model or default_settings.openai_model
        self._max_input_tokens = (
            max_input_tokens
            if max_input_tokens is not None
            else default_settings.openai_max_input_tokens
        )
        self._safety_margin_tokens = (
            safety_margin_tokens
            if safety_margin_tokens is not None
            else default_settings.openai_safety_margin_tokens
        )
        self._client = OpenAI(api_key=api_key)

    def extract(
        self, enterprise_number: str, ref: FilingReference
    ) -> Optional[FinancialStatement]:
        with timed(f"llm.extract[{ref.reference}]"):
            try:
                pdf_bytes = self._nbb.download_pdf(ref.reference)
            except Exception as exc:
                logger.warning(
                    "Could not download PDF for filing %s: %s", ref.reference, exc
                )
                return None

            with timed(f"llm.pdf_to_text[{ref.reference}]"):
                text = _pdf_to_text(pdf_bytes)
            if not text.strip():
                raise FinancialExtractionError(
                    f"Empty text extracted from PDF for filing {ref.reference}"
                )

            with timed(f"llm.openai_call[{ref.reference}]"):
                payload = self._call_openai(text)
            return self._build_statement(enterprise_number, ref, payload)

    def _call_openai(self, text: str) -> dict:
        # First, keep only sections 3.1/3.2/4/6.10 (falls back to full
        # text if segmentation finds no headers). Then enforce a token
        # budget so the request never exceeds the model's input cap.
        body, diag = select_financial_text(text)
        if diag.get("segmented"):
            logger.info(
                "LLM payload trimmed: %d → %d chars (%s)",
                diag["original_chars"],
                diag["kept_chars"],
                ", ".join(diag.get("sections_matched", [])),
            )
        else:
            logger.info(
                "LLM payload not segmented (%s); sending full text",
                diag.get("reason", "unknown reason"),
            )

        # Budget: leave headroom for the system prompt and the model's
        # completion. We pass max_input_tokens − system_prompt_tokens − margin
        # to the truncator so even if the segmenter fails on a CONSO filing
        # we stay under the hard input-token cap.
        system_tokens = count_tokens(_SYSTEM_PROMPT, self._model)
        user_budget = (
            self._max_input_tokens - system_tokens - self._safety_margin_tokens
        )
        if user_budget <= 0:
            raise FinancialExtractionError(
                f"Token budget exhausted by system prompt ({system_tokens} tokens) "
                f"and safety margin ({self._safety_margin_tokens}) — "
                f"max_input_tokens={self._max_input_tokens} is too small."
            )

        payload_text, used_tokens, truncated = truncate_to_token_budget(
            body, user_budget, self._model
        )
        if truncated:
            logger.warning(
                "LLM payload truncated to fit token budget: %d tokens (of %d cap, "
                "system=%d, margin=%d)",
                used_tokens,
                self._max_input_tokens,
                system_tokens,
                self._safety_margin_tokens,
            )

        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": payload_text},
            ],
            response_format={"type": "json_schema", "json_schema": _RESPONSE_SCHEMA},
            temperature=0,
        )
        content = response.choices[0].message.content
        if not content:
            raise FinancialExtractionError("OpenAI returned an empty response")
        return json.loads(content)

    def _build_statement(
        self,
        enterprise_number: str,
        ref: FilingReference,
        payload: dict,
    ) -> FinancialStatement:
        def _dec(value: object) -> Optional[Decimal]:
            if value is None:
                return None
            try:
                return Decimal(str(value))
            except Exception:
                return None

        return FinancialStatement(
            enterprise_number=enterprise_number,
            reference=ref.reference,
            fiscal_year=ref.fiscal_year,
            exercise_start=ref.exercise_start,
            exercise_end=ref.exercise_end,
            source=FilingFormat.PDF,
            revenue=_dec(payload.get("revenue")),
            operating_profit=_dec(payload.get("operating_profit")),
            net_profit=_dec(payload.get("net_profit")),
            total_assets=_dec(payload.get("total_assets")),
            fixed_assets=_dec(payload.get("fixed_assets")),
            current_assets=_dec(payload.get("current_assets")),
            total_equity=_dec(payload.get("total_equity")),
            total_liabilities=_dec(payload.get("total_liabilities")),
            long_term_debt=_dec(payload.get("long_term_debt")),
            short_term_debt=_dec(payload.get("short_term_debt")),
            cash_and_equivalents=_dec(payload.get("cash_and_equivalents")),
            inventory=_dec(payload.get("inventory")),
            depreciation=_dec(payload.get("depreciation")),
            employees_fte=_dec(payload.get("employees_fte")),
            raw_headings={},
        )
