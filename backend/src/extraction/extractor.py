"""Build a normalised :class:`FinancialStatement` for one filing.

Strategy:

1. If the filing is in XBRL (since 2007) and JSON is available
   (since 2022-04-04), fetch the structured JSON from the NBB
   Authentic Data Query endpoint and read the accounting headings
   directly. This is the authoritative path.

2. Otherwise fall back to PDF parsing: download the filing PDF and
   use heading codes to locate values on the standardised form.

PDF parsing on these filings is a heuristic, not OCR — the documents
are text-based PDFs with a regular layout, so a code -> value scan
is reliable for the line items we expose. Companies whose filings
predate digital deposit (pre-1999) have no PDF available and will
yield only partial statements.
"""

from __future__ import annotations

import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Optional

import pymupdf  # 10–30× faster than pdfplumber on plain-text extraction

from src._timing import timed
from src.exceptions import FinancialExtractionError
from src.models import FilingFormat, FilingReference, FinancialStatement
from src.nbb.client import NBBClient

from .headings import HEADING_MAP

logger = logging.getLogger(__name__)

NUMBER_RE = re.compile(r"-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:[.,]\d+)?")


class FinancialExtractor:
    def __init__(self, nbb_client: NBBClient) -> None:
        self._nbb = nbb_client

    def extract(
        self, enterprise_number: str, ref: FilingReference
    ) -> Optional[FinancialStatement]:
        with timed(f"extract[{ref.reference}]"):
            statement = self._try_json(enterprise_number, ref)
            if statement is not None:
                return statement
            return self._extract_from_pdf(enterprise_number, ref)

    def _try_json(
        self, enterprise_number: str, ref: FilingReference
    ) -> Optional[FinancialStatement]:
        try:
            payload = self._nbb.fetch_accounting_json(ref.reference)
        except Exception as exc:
            logger.warning("JSON fetch failed for %s: %s", ref.reference, exc)
            return None
        if not payload:
            return None

        headings = _flatten_xbrl_headings(payload)
        if not headings:
            return None

        return _build_statement(
            enterprise_number=enterprise_number,
            ref=ref,
            headings=headings,
            source=FilingFormat.XBRL,
        )

    def _extract_from_pdf(
        self, enterprise_number: str, ref: FilingReference
    ) -> Optional[FinancialStatement]:
        try:
            pdf_bytes = self._nbb.download_pdf(ref.reference)
        except Exception as exc:
            logger.warning("Could not download PDF for filing %s: %s", ref.reference, exc)
            return None

        with timed(f"pdf.parse[{ref.reference}]"):
            text = _pdf_to_text(pdf_bytes)
        if not text.strip():
            raise FinancialExtractionError(
                f"Empty text extracted from PDF for filing {ref.reference}"
            )
        headings = _scan_pdf_headings(text)
        return _build_statement(
            enterprise_number=enterprise_number,
            ref=ref,
            headings=headings,
            source=FilingFormat.PDF,
        )


def _build_statement(
    *,
    enterprise_number: str,
    ref: FilingReference,
    headings: dict[str, Decimal],
    source: FilingFormat,
) -> FinancialStatement:
    fields: dict[str, Optional[Decimal]] = {}
    for field, codes in HEADING_MAP.items():
        for code in codes:
            if code in headings:
                fields[field] = headings[code]
                break
        else:
            fields[field] = None

    return FinancialStatement(
        enterprise_number=enterprise_number,
        reference=ref.reference,
        fiscal_year=ref.fiscal_year,
        exercise_start=ref.exercise_start,
        exercise_end=ref.exercise_end,
        source=source,
        raw_headings=headings,
        **fields,
    )


def _flatten_xbrl_headings(payload: dict) -> dict[str, Decimal]:
    """Walk the accountingData JSON and pull out (code -> current-period value).

    The NBB JSON wraps each datum as `{"Code": "70", "Value": 1234.56,
    "Period": "Current"}` (or similar). The exact key casing may vary
    by schema version, so we read defensively.
    """
    out: dict[str, Decimal] = {}
    for entry in _iter_entries(payload):
        code = entry.get("Code") or entry.get("code") or entry.get("rubric")
        if not code:
            continue
        period = (entry.get("Period") or entry.get("period") or "current").lower()
        if period not in ("current", "n", "current_year"):
            continue
        value = entry.get("Value", entry.get("value"))
        decimal_value = _to_decimal(value)
        if decimal_value is None:
            continue
        out[str(code).strip()] = decimal_value
    return out


def _iter_entries(node: object):
    if isinstance(node, dict):
        if "Code" in node or "code" in node or "rubric" in node:
            yield node
        for value in node.values():
            yield from _iter_entries(value)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_entries(item)


def _pdf_to_text(pdf_bytes: bytes) -> str:
    """Extract plain text from a PDF byte stream.

    Backed by PyMuPDF (``import pymupdf``) which wraps the MuPDF C
    library. Roughly 10–30× faster than pdfplumber on plain-text
    extraction because it skips pdfplumber's layout-analysis pass —
    fine for our use case since downstream consumers (the LLM and the
    regex scanner) only need linear text, not laid-out tables.

    The NBB standardised layout puts the schema/section header on its
    own line near the top of every page, so ``page.get_text("text")``
    preserves the structure the page segmenter depends on.
    """
    chunks: list[str] = []
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        for page in doc:
            chunks.append(page.get_text("text"))
    return "\n".join(chunks)


_PAGE_FOOTER_RE = re.compile(r"^Page \d+ of \d+$")
_SECTION_HEADER_RE = re.compile(r"^A-app\b|^N[°º]|^XXXXXXXXX")


def _scan_pdf_headings(text: str) -> dict[str, Decimal]:
    """Locate accounting codes followed by numeric values on the same line.

    NBB standardised filings render each row roughly as
        ``Heading label   <code>   <value-N>   <value-N-1>``
    so the first number after the code is the current-year value.
    """
    out: dict[str, Decimal] = {}
    wanted = {code for codes in HEADING_MAP.values() for code in codes}
    # Negative lookahead (?![.,]\d) prevents matching a code that is
    # actually the integer part of a decimal number (e.g. "17" in "17.962").
    # Sort longest first so "17/49" is tried before "17" in the alternation.
    code_pattern = re.compile(
        r"\b(" + "|".join(re.escape(c) for c in sorted(wanted, key=len, reverse=True)) + r")\b(?![.,]\d)"
    )

    for line in text.splitlines():
        stripped = line.strip()
        if _PAGE_FOOTER_RE.match(stripped):
            continue
        for match in code_pattern.finditer(line):
            code = match.group(1)
            tail = line[match.end():]
            num_match = NUMBER_RE.search(tail)
            if not num_match:
                continue
            value = _to_decimal(num_match.group(0))
            if value is None:
                continue
            out[code] = value
    return out


def _to_decimal(value: object) -> Optional[Decimal]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float, Decimal)):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None
    if isinstance(value, str):
        cleaned = value.strip().replace(" ", "").replace(" ", "")
        if cleaned.count(",") == 1 and cleaned.count(".") >= 1:
            cleaned = cleaned.replace(".", "").replace(",", ".")
        elif cleaned.count(",") == 1 and "." not in cleaned:
            cleaned = cleaned.replace(",", ".")
        else:
            cleaned = cleaned.replace(" ", "")
        try:
            return Decimal(cleaned)
        except InvalidOperation:
            return None
    return None
