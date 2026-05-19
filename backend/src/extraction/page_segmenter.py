"""Slice an NBB filing's pdfplumber dump into named sections.

NBB filings stamp every page with the schema and section number in the
header line, e.g. ``VOL-kap 3.1``, ``VKT-kap 4``, ``M-kap 6``, ``CONSO 3.2``.
We detect that stamp and group the document into sections so callers
(notably :class:`LLMExtractor`) can send only the financial sections to
the LLM and skip the auditor report, valuation rules, social balance, etc.

The sections we keep for financial-value extraction:

* ``3``     — Balance Sheet (parent section in micro filings)
* ``3.1``   — Balance Sheet, Assets
* ``3.2``   — Balance Sheet, Liabilities
* ``4``     — Income Statement
* ``6.10``  — Operating Results Detail (where FTE 9087 lives, plus turnover breakdown)

If we can't recognise any sections on a filing — which happens for the
~5% of pdfplumber dumps where the header stamp gets mangled — we fall
back to the full text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Examples we need to catch in the page-header text:
#   "VOL-kap 3.1"      (Naamloze vennootschap, full schema, section 3.1)
#   "VKT-kap 4"        (BV, abbreviated schema, section 4)
#   "M-kap 6"          (micro)
#   "VOL-app 6.10"     (asbl-equivalent full)
#   "C-ASBL 3.2"       (non-profit full)
#   "CONSO 4"          (consolidated)
#   "MIC-app 3"        (micro asbl)
_SECTION_HEADER_RE = re.compile(
    r"\b(VOL|VKT|M|MIC|CONSO|C-ASBL)(?:-(?:kap|app|vzw|sti|jp))?\s+(\d+(?:\.\d+){0,2})\b",
    re.IGNORECASE,
)

# Sections worth sending to the LLM for the 14 fields in FinancialStatement.
FINANCIAL_SECTIONS = frozenset({"3", "3.1", "3.2", "4", "6.10"})


@dataclass(slots=True)
class PageInfo:
    page_number: int
    schema: str | None
    section: str | None
    text: str


def parse_pages(text: str) -> list[PageInfo]:
    """Split a pdfplumber dump into pages and tag each with its section.

    Relies on the page banners we write in ``compare_extractors.py`` /
    ``_pdf_to_text`` — i.e. each page is separated by the pdfplumber
    page boundary (``"\\n"`` between pages). We then look at the first
    ~10 lines of each page to find the schema/section stamp.

    When the dump comes from :func:`_pdf_to_text` (which joins pages with
    a single newline and no explicit page banner), we still detect each
    section header where it appears and treat the text up to the next
    header as that section's content. That gives us section-level
    grouping rather than strict page-level, which is what we actually
    want for the LLM payload.
    """
    pages: list[PageInfo] = []
    matches = list(_SECTION_HEADER_RE.finditer(text))
    if not matches:
        return [PageInfo(1, None, None, text)]

    # Treat each header occurrence as the start of a section block;
    # the block runs until the next header occurrence (or EOF).
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        pages.append(
            PageInfo(
                page_number=i + 1,
                schema=m.group(1).upper(),
                section=m.group(2),
                text=text[start:end],
            )
        )
    return pages


def select_financial_text(text: str) -> tuple[str, dict]:
    """Return ``(trimmed_text, diagnostics)``.

    ``trimmed_text`` is the concatenation of every page whose detected
    section is in :data:`FINANCIAL_SECTIONS`. If segmentation finds no
    headers at all, we return the original text unchanged (the caller
    can still truncate as a last resort).

    ``diagnostics`` is a small dict useful for the benchmark report:
    section ids matched, page count kept, original/new character length.
    """
    pages = parse_pages(text)
    kept = [p for p in pages if p.section and _section_matches(p.section)]

    if not kept:
        return text, {
            "segmented": False,
            "reason": "no recognised section headers — sending full text",
            "original_chars": len(text),
            "kept_chars": len(text),
            "sections_matched": [],
        }

    body = "\n".join(p.text for p in kept)
    return body, {
        "segmented": True,
        "original_chars": len(text),
        "kept_chars": len(body),
        "sections_matched": sorted({p.section for p in kept if p.section}),
        "pages_kept": len(kept),
        "pages_total": len(pages),
    }


def _section_matches(section: str) -> bool:
    """Match section ``3.1.1`` against the wanted set including parent ``3``."""
    if section in FINANCIAL_SECTIONS:
        return True
    # A sub-section of 3 (e.g. 3.1.2) still belongs to the balance sheet block.
    head = section.split(".", 1)[0]
    return head in FINANCIAL_SECTIONS
