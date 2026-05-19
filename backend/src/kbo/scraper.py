"""Scraper for KBO/CBE public search (kbopub.economie.fgov.be).

The KBO public search has no JSON API. We submit the phonetic name search
form, parse the result list, then fetch the company detail page to collect
canonical fields (name, legal form, address, status, start date).

Reuse of CBE data is restricted: this module does targeted, single-entity
lookups on demand and is not suitable for bulk scraping. For bulk needs,
use the official monthly CSV open-data extracts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from src._enterprise_number import (
    format_human as _format_enterprise_number,
    normalise as _normalise_enterprise_number,
)
from src._timing import timed
from src.exceptions import AmbiguousCompanyError, CompanyNotFoundError
from src.models import Company, Function, NaceCode

KBO_BASE = "https://kbopub.economie.fgov.be/kbopub"
SEARCH_BY_NAME = f"{KBO_BASE}/zoeknaamfonetischform.html"
DETAIL_BY_NUMBER = f"{KBO_BASE}/toonondernemingps.html"

ENTERPRISE_NUMBER_RE = re.compile(r"\b([01]\d{3}[.\s]?\d{3}[.\s]?\d{3})\b")
DATE_FORMATS = (
    "%d.%m.%Y",
    "%d/%m/%Y",
    "%Y-%m-%d",
    "%B %d, %Y",
    "%b %d, %Y",
)

# NACE codes are 2-5 digit numeric with optional dot separators
# (e.g. 47.11, 47.11.1, 74.999). We anchor on `\b` because the
# section header itself can contain a year that also matches.
NACE_CODE_RE = re.compile(r"\b(\d{2}\.\d{1,3}(?:\.\d{1,3})?)\b")

# Section title detector for "Version of the Nacebel codes for the
# VAT activities 2025" and friends. Captures (source, version_year).
NACE_HEADER_RE = re.compile(
    r"Nacebel codes for the (VAT|NSSO|EDRL) activities\s+(\d{4})",
    re.IGNORECASE,
)

# "Since January 1, 2025" / "Sinds 1 januari 2025" / "Depuis le 1er janvier 2025"
SINCE_RE = re.compile(
    r"(?:Since|Sinds|Depuis(?:\s+le)?)\s+(.+?)(?:\s*$|\s{2,})",
    re.IGNORECASE,
)


class _Section:
    GENERAL = "general"
    FUNCTIONS = "functions"
    CHARACTERISTICS = "characteristics"
    AUTHORISATIONS = "authorisations"
    NACE = "nace"
    OTHER = "other"


_SECTION_MATCHERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (_Section.GENERAL, re.compile(r"^In general\b", re.I)),
    (_Section.FUNCTIONS, re.compile(r"^Functions\b", re.I)),
    (_Section.CHARACTERISTICS, re.compile(r"^Characteristics\b", re.I)),
    (_Section.AUTHORISATIONS, re.compile(r"^Authorisations?\b", re.I)),
    (_Section.NACE, NACE_HEADER_RE),
)


# Belgian postal codes are 4 digits, sometimes followed by a city. The
# KBO results table renders an address-like cell next to the name; we
# pull it via this pattern.
_BE_POSTCODE_RE = re.compile(r"\b\d{4}\b\s+[A-ZÉÈÀÂÄÔÖÙÛÇa-zéèàâäôöùûç][^,]*")


@dataclass(slots=True)
class KBOCandidate:
    enterprise_number: str
    name: str
    address: Optional[str] = None


def _parse_date(text: str) -> Optional[date]:
    text = text.strip()
    if not text:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


class KBOScraper:
    """Resolve a company name (or number) to a structured Company record."""

    def __init__(self, client: Optional[httpx.Client] = None, timeout: float = 30.0) -> None:
        self._owns_client = client is None
        self._client = client or httpx.Client(
            timeout=timeout,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (compatible; legal-financial-enrichment/0.1; "
                    "targeted CBE lookup)"
                ),
                "Accept-Language": "en,fr;q=0.8,nl;q=0.7",
            },
            follow_redirects=True,
        )

    def __enter__(self) -> "KBOScraper":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def lookup(self, query: str) -> Company:
        """Resolve `query` to a :class:`Company`.

        `query` may be a company name or a 10-digit enterprise number
        (with or without dots/spaces).
        """
        query = query.strip()
        if not query:
            raise CompanyNotFoundError("Empty query")

        try:
            number = _normalise_enterprise_number(query)
        except ValueError:
            number = self._search_by_name(query)
        return self._fetch_detail(number)

    def _search_by_name(self, name: str) -> str:
        params = {
            "searchWord": name,
            "_oudeBenaming": "on",
            "pstcdeNPRP": "",
            "postgemeente1": "",
            "ondNP": "true",
            "_ondNP": "on",
            "ondRP": "true",
            "_ondRP": "on",
            "rechtsvormFonetic": "ALL",
            "vest": "true",
            "_vest": "on",
            "filterEnkelActieve": "true",
            "_filterEnkelActieve": "on",
            "actionNPRP": "Rechercher",
        }
        with timed("kbo.search_by_name"):
            resp = self._client.get(SEARCH_BY_NAME, params=params)
        resp.raise_for_status()
        candidates = self._parse_candidates(resp.text)

        if not candidates:
            raise CompanyNotFoundError(f"No KBO match for {name!r}")

        exact = [c for c in candidates if c.name.casefold() == name.casefold()]
        if len(exact) == 1:
            return exact[0].enterprise_number
        if len(candidates) == 1:
            return candidates[0].enterprise_number

        raise AmbiguousCompanyError(
            f"{len(candidates)} KBO matches for {name!r}; refine the query.",
            candidates=[
                {
                    "enterprise_number": c.enterprise_number,
                    "name": c.name,
                    "address": c.address,
                }
                for c in candidates[:25]
            ],
        )

    def _parse_candidates(self, html: str) -> list[KBOCandidate]:
        soup = BeautifulSoup(html, "lxml")
        seen: dict[str, KBOCandidate] = {}

        for row in soup.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in row.find_all("td")]
            if len(cells) < 2:
                continue
            match = ENTERPRISE_NUMBER_RE.search(" ".join(cells))
            if not match:
                continue
            try:
                number = _normalise_enterprise_number(match.group(1))
            except ValueError:
                continue
            # Name = first non-empty cell that isn't just the CBE number.
            # Address = first cell after the name that matches a Belgian
            # postcode + city pattern. Falls back to None when the row
            # only has minimal info.
            name_cell = ""
            address_cell: Optional[str] = None
            for c in cells:
                if not c or ENTERPRISE_NUMBER_RE.fullmatch(c):
                    continue
                if not name_cell:
                    name_cell = c
                    continue
                if address_cell is None and _BE_POSTCODE_RE.search(c):
                    address_cell = c.strip()
                    break
            seen.setdefault(
                number,
                KBOCandidate(number, name_cell, address_cell),
            )

        if seen:
            return list(seen.values())

        for link in soup.find_all("a", href=True):
            href = link["href"]
            if "ondernemingsnummer=" not in href:
                continue
            num_match = ENTERPRISE_NUMBER_RE.search(href.replace("=", " "))
            if not num_match:
                continue
            try:
                number = _normalise_enterprise_number(num_match.group(1))
            except ValueError:
                continue
            seen.setdefault(number, KBOCandidate(number, link.get_text(strip=True)))
        return list(seen.values())

    def _fetch_detail(self, enterprise_number: str) -> Company:
        params = {
            "lang": "en",
            "ondernemingsnummer": enterprise_number,
        }
        with timed("kbo.fetch_detail"):
            resp = self._client.get(DETAIL_BY_NUMBER, params=params)
        resp.raise_for_status()
        html = resp.text
        if "not registered" in html.lower() or "geen onderneming" in html.lower():
            raise CompanyNotFoundError(
                f"Enterprise number {_format_enterprise_number(enterprise_number)} not found."
            )
        return self._parse_detail(enterprise_number, html)

    def _parse_detail(self, enterprise_number: str, html: str) -> Company:
        soup = BeautifulSoup(html, "lxml")
        sections = self._collect_sections(soup)

        general = sections.get(_Section.GENERAL, {})  # type: ignore[arg-type]
        general_pairs = general if isinstance(general, dict) else {}

        raw_name = (
            general_pairs.get("name")
            or general_pairs.get("denomination")
            or _first_heading_name(soup)
            or _format_enterprise_number(enterprise_number)
        )
        name = _clean_company_name(raw_name)

        status_text = general_pairs.get("status", "")
        dissolution_date = _detect_dissolution(status_text, general_pairs)

        characteristics = sections.get(_Section.CHARACTERISTICS, [])
        vat_subject = _detect_vat_subject(characteristics)  # type: ignore[arg-type]

        return Company(
            enterprise_number=enterprise_number,
            name=name,
            trade_name=general_pairs.get("name in another language")
            or general_pairs.get("commercial name"),
            legal_form=general_pairs.get("legal form") or general_pairs.get("juridische vorm"),
            address=general_pairs.get("address of the registered office")
            or general_pairs.get("address")
            or general_pairs.get("adres"),
            status=status_text or None,
            start_date=_parse_date(
                general_pairs.get("start date") or general_pairs.get("startdatum") or ""
            ),
            dissolution_date=dissolution_date,
            vat_subject=vat_subject,
            nace_codes=sections.get(_Section.NACE, []),  # type: ignore[arg-type]
            functions=sections.get(_Section.FUNCTIONS, []),  # type: ignore[arg-type]
        )

    def _collect_sections(self, soup: BeautifulSoup) -> dict[str, object]:
        """Walk every row once, dispatching to the right section parser.

        We don't trust the HTML's nesting — KBO pages use one giant flat
        table with section-header rows interleaved with data rows. So we
        do a single linear pass, track the current section via the most
        recently-seen header, and let per-section helpers accumulate.
        """
        general: dict[str, str] = {}
        characteristics: list[str] = []
        authorisations: list[str] = []
        nace_codes: list[NaceCode] = []
        functions: list[Function] = []

        current = _Section.OTHER
        nace_source: Optional[str] = None
        nace_version: Optional[int] = None

        for row in soup.find_all("tr"):
            cells = row.find_all("td")
            if not cells:
                continue
            row_text = row.get_text(" ", strip=True)

            header = _match_section_header(row_text)
            if header is not None:
                current, nace_source, nace_version = header
                continue

            if current == _Section.GENERAL and len(cells) >= 2:
                label = cells[0].get_text(" ", strip=True).rstrip(":").lower()
                value = cells[1].get_text(" ", strip=True)
                if label and value:
                    general.setdefault(label, value)

            elif current == _Section.CHARACTERISTICS:
                if row_text:
                    characteristics.append(row_text)

            elif current == _Section.AUTHORISATIONS:
                if row_text:
                    authorisations.append(row_text)

            elif current == _Section.NACE:
                nace = _parse_nace_row(row_text, nace_source, nace_version)
                if nace is not None:
                    nace_codes.append(nace)

            elif current == _Section.FUNCTIONS:
                func = _parse_function_row(cells, row_text)
                if func is not None:
                    functions.append(func)

        return {
            _Section.GENERAL: general,
            _Section.CHARACTERISTICS: characteristics,
            _Section.AUTHORISATIONS: authorisations,
            _Section.NACE: nace_codes,
            _Section.FUNCTIONS: functions,
        }


def _first_heading_name(soup: BeautifulSoup) -> Optional[str]:
    for tag in ("h1", "h2", "h3"):
        node = soup.find(tag)
        if node and node.get_text(strip=True):
            return node.get_text(strip=True)
    return None


def _match_section_header(row_text: str) -> Optional[tuple[str, Optional[str], Optional[int]]]:
    """If *row_text* looks like a section header, return (section, source, version).

    `source` and `version` are populated only for NACE section headers
    (e.g. "Version of the Nacebel codes for the VAT activities 2025"
    yields ``("nace", "VAT", 2025)``).
    """
    nace = NACE_HEADER_RE.search(row_text)
    if nace is not None:
        return _Section.NACE, nace.group(1).upper(), int(nace.group(2))
    for section, pattern in _SECTION_MATCHERS:
        if section == _Section.NACE:
            continue  # already handled above
        if pattern.search(row_text):
            return section, None, None
    return None


def _parse_nace_row(
    row_text: str,
    section_source: Optional[str],
    section_version: Optional[int],
) -> Optional[NaceCode]:
    """Build a :class:`NaceCode` from one row of a Nacebel section.

    Example row text:
        ``"VAT 2025 74.999 - Other liberal professions ... Since January 1, 2025"``

    Source and version may also be carried only by the section header,
    in which case the row itself just has ``"74.999 - Other..."``. We
    prefer values found in the row and fall back to the header values.
    """
    text = row_text.strip()
    if not text:
        return None

    code_match = NACE_CODE_RE.search(text)
    if code_match is None:
        return None
    code = code_match.group(1)

    source = section_source
    version = section_version
    prefix = text[: code_match.start()].strip()
    prefix_match = re.match(r"(VAT|NSSO|EDRL)\s+(\d{4})", prefix, re.IGNORECASE)
    if prefix_match is not None:
        source = prefix_match.group(1).upper()
        version = int(prefix_match.group(2))

    rest = text[code_match.end():].lstrip(" -–:").strip()
    since = None
    description = rest
    since_match = SINCE_RE.search(rest)
    if since_match is not None:
        description = rest[: since_match.start()].rstrip(" -–")
        since = _parse_date(since_match.group(1))

    return NaceCode(
        code=code,
        description=description or None,
        source=source,
        version=version,
        since=since,
    )


def _parse_function_row(cells: list, row_text: str) -> Optional[Function]:
    """Pull a Function entry out of a Functions-section row.

    KBO renders function rows in a few different layouts (natural-person
    vs legal-entity holder, with or without a link), so we read the row
    text and look for the holder's CBE number, role, and effective date
    rather than relying on a fixed column ordering.
    """
    text = row_text.strip()
    if not text:
        return None

    since = None
    since_match = SINCE_RE.search(text)
    if since_match is not None:
        since = _parse_date(since_match.group(1))
        text = text[: since_match.start()].rstrip(" ,-–")

    holder_enterprise_number = None
    num_match = ENTERPRISE_NUMBER_RE.search(text)
    if num_match is not None:
        try:
            holder_enterprise_number = _normalise_enterprise_number(num_match.group(1))
        except ValueError:
            pass
        text = (text[: num_match.start()] + text[num_match.end():]).strip(" ,-–")

    # The first cell typically holds the role; whatever's left after
    # stripping the holder number/date is the holder's name.
    role = cells[0].get_text(" ", strip=True).rstrip(":") if cells else ""
    holder_name: Optional[str] = None
    if role and text.lower().startswith(role.lower()):
        holder_name = text[len(role):].lstrip(" ,-–:").strip() or None
    elif role and text:
        holder_name = text.replace(role, "", 1).strip(" ,-–:") or None
    else:
        holder_name = text or None

    if not role and not holder_name:
        return None
    return Function(
        role=role or "Unknown",
        holder_name=holder_name,
        holder_enterprise_number=holder_enterprise_number,
        since=since,
    )


def _detect_vat_subject(characteristics: list[str]) -> Optional[bool]:
    """Return True/False if the Characteristics section mentions VAT subjection.

    When no characteristic mentions VAT we return None rather than False
    so callers can distinguish "not subject" from "data missing".
    """
    if not characteristics:
        return None
    for line in characteristics:
        lowered = line.lower()
        if "subject to vat" in lowered or "btw-plichtig" in lowered or "assujetti à la tva" in lowered:
            return True
    if any("vat" in line.lower() or "btw" in line.lower() or "tva" in line.lower()
           for line in characteristics):
        return False
    return None


# Patterns that mark the end of an actual company name and the start of
# KBO's "denomination metadata" tail. KBO sometimes packs both into one
# HTML cell (``<td>WINDEUROPE<br>Name in French, since April 6, 2016</td>``)
# which BeautifulSoup's ``get_text(" ", strip=True)`` flattens with a
# space. The result looks like "WINDEUROPE Name in French, since ..."
# which is *not* a company name — it's a name + metadata blob.
_NAME_METADATA_TAIL = re.compile(
    r"\s+(?:"
    r"Name\s+(?:in|en|au)\b"          # EN: "Name in French"
    r"|Nom\s+(?:en|au)\b"             # FR: "Nom en français"
    r"|Naam\s+(?:in|als)\b"           # NL: "Naam in het Frans"
    r"|since\s+\w+"                   # EN tail: "since April 6, 2016"
    r"|depuis\s+(?:le\s+)?\w+"        # FR tail
    r"|sinds\s+\d"                    # NL tail
    r"|\(?in\s+\w+\s+language\b"      # "(in French language ..."
    r")",
    re.IGNORECASE,
)


def _clean_company_name(raw: str) -> str:
    """Return the actual company name, stripping any denomination metadata tail.

    The detail page sometimes serialises a denomination cell as
    ``"WINDEUROPE\nName in French, since April 6, 2016"``; ``get_text``
    joins the two with a space and our parser sees a name with a
    metadata suffix glued on. We cut at the first metadata marker
    we recognise across EN/FR/NL.

    Trailing whitespace and the colon some labels carry are stripped.
    """
    if not raw:
        return raw
    cleaned = raw.strip()
    match = _NAME_METADATA_TAIL.search(cleaned)
    if match is not None:
        cleaned = cleaned[: match.start()].strip()
    # KBO often follows the name with a colon; tolerate that.
    return cleaned.rstrip(":").strip()


def _detect_dissolution(status: str, general: dict[str, str]) -> Optional[date]:
    """Try to find a dissolution date on the page.

    KBO doesn't expose a stable "dissolution date" field — when an entity
    is dissolved the status string usually carries the date inline
    (e.g. ``"Dissolved (judgement) since 2021-04-12"``). We also probe
    explicit end-date fields that appear on some pages.
    """
    if not status:
        return _parse_date(general.get("end date") or general.get("einddatum") or "")
    lowered = status.lower()
    if not any(
        marker in lowered
        for marker in ("dissol", "stopgezet", "cessation", "liquidat")
    ):
        return _parse_date(general.get("end date") or general.get("einddatum") or "")
    since_match = SINCE_RE.search(status)
    if since_match is not None:
        parsed = _parse_date(since_match.group(1))
        if parsed is not None:
            return parsed
    return _parse_date(general.get("end date") or general.get("einddatum") or "")
