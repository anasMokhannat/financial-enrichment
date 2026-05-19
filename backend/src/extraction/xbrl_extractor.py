"""XBRL-backed financial extractor.

The NBB Authentic Data Query exposes XBRL representations of every
full-schema (VOL) filing deposited since 2007. XBRL is tagged Belgian-
GAAP data — facts carry the canonical NBB heading code in their
element name, with explicit contexts that pin them to a fiscal period.
That makes value extraction:

* deterministic — no LLM inference required;
* fast — local lxml parse, no network round-trip beyond fetching the
  file once; and
* exact — no rounding from PDF-text re-parsing.

Coverage caveat: abbreviated and micro filings have spotty XBRL
support, and pre-2007 filings have none. When the NBB endpoint returns
404 or the file has no recognisable facts, this extractor returns
``None`` and the chain falls through to the LLM (or regex).

Element-name strategy
---------------------
Belgian XBRL files use the BeNGAAP taxonomy. Concept local names embed
the NBB heading code somewhere — exact form varies between taxonomy
versions (``HeadingCode70``, ``Code_20_58``, ``Turnover_70``). Rather
than maintain a hardcoded list of element names, we scan every fact's
local name for a digit-run that looks like a heading code (e.g. ``70``,
``20/58``, ``9904``) and look it up against :data:`HEADING_MAP`. This
is forward-compatible with new taxonomy revisions as long as they keep
the code in the element name.

Code disambiguation (FIX #1)
----------------------------
A naive "first digit-run wins" approach confuses parent totals with
sub-items: an element named ``Code620_Remuneration`` contains both
``620`` (direct pay, a sub-item) and could match against ``62`` (total
personnel costs) if the regex isn't anchored. We therefore (a) use a
strict regex with non-digit boundaries and (b) prefer the *longest*
matching code when multiple candidates are valid — the longer code is
always the more specific sub-item, never the parent total.

Context handling (FIX #2)
-------------------------
Belgian XBRL filings carry multiple contexts even for a single fiscal
year: an "instant" context for the balance-sheet date and a "duration"
context for the P&L period. Filtering on a single ``contextRef`` would
drop half the facts. We instead identify *all* contexts whose period
endDate matches the latest fiscal year and accept facts from any of
them.

Post-extraction validation (FIX #3)
-----------------------------------
The balance sheet obeys rigid accounting identities (assets = equity
+ liabilities + provisions, etc.). After extraction we run these
identities as a sanity check and log warnings on any drift — that's
the cheapest way to detect a code-mapping bug or a unit-scaling issue.
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from typing import Optional

from lxml import etree

from src._timing import timed
from src.models import FilingFormat, FilingReference, FinancialStatement
from src.nbb.client import NBBClient

from .headings import HEADING_MAP

logger = logging.getLogger(__name__)

# XBRL standard namespace (xbrli prefix) — same across every Belgian
# filing regardless of taxonomy version.
_XBRLI_NS = "http://www.xbrl.org/2003/instance"

# Heading-code pattern: 2-5 digits, optionally followed by "/" + 1-3
# digits OR "_" + 1-3 digits (Belgian XBRL sometimes uses underscores
# in place of slashes because XML local names can't contain "/").
#
# Tightened vs. original:
#   - {2,5} not {1,5}: NBB codes are always at least 2 digits.
#   - (?<!\d) / (?!\d): non-digit boundaries on both sides, so we
#     don't slice "620" out of "62000" or grab "70" out of "70A12".
_CODE_RE = re.compile(r"(?<!\d)(\d{2,5}(?:[/_]\d{1,3})?)(?!\d)")

# Tolerance (in EUR) for accounting-identity validation. Belgian
# filings round to whole euros, so any drift above ~1 EUR per term
# indicates a real extraction bug rather than rounding noise.
_VALIDATION_TOLERANCE = Decimal("2")


def _parse_xbrl_number(text: str) -> Optional[Decimal]:
    """Permissive numeric parser for XBRL fact values.

    The XBRL spec mandates "." as decimal separator and no thousands
    separators. Most Belgian filings comply, but some — particularly
    the social-balance facts like code 9087 (average FTE headcount,
    typically a non-integer like ``457,9``) — leak the locale's comma
    decimal through. We try strict first and fall back to a Belgian/
    European-style parse so those facts still land.

    Returns None when the value can't be coerced under either format.
    """
    text = text.strip()
    if not text:
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        pass
    # Strip ASCII spaces and Unicode non-breaking space; some filings
    # use NBSP as a thousands separator.
    cleaned = text.replace(" ", "").replace("\xa0", "")
    if "," in cleaned and "." in cleaned:
        # "1.234.567,89" → "1234567.89" (Belgian/EU full form).
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        # "457,9" → "457.9" (comma-decimal only).
        cleaned = cleaned.replace(",", ".")
    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


def _local(tag: str) -> str:
    """Return the local part of an XML tag, dropping the Clark namespace prefix."""
    return etree.QName(tag).localname


def _build_code_to_field() -> dict[str, str]:
    """Invert HEADING_MAP: code -> first FinancialStatement field that wants it."""
    out: dict[str, str] = {}
    for field, codes in HEADING_MAP.items():
        for code in codes:
            # Normalise: the XBRL form may use "_" instead of "/".
            out.setdefault(code, field)
            out.setdefault(code.replace("/", "_"), field)
    return out


_CODE_TO_FIELD = _build_code_to_field()


# Inverse of _CODE_TO_FIELD: field -> canonical code (first one in HEADING_MAP).
# Used to inject a synthetic "code" into the facts dict when we resolved a fact
# via a semantic-name match, so :func:`_build_statement` (which is keyed on
# codes) can still find the value without a separate code-vs-field code path.
_FIELD_TO_CANONICAL_CODE: dict[str, str] = {
    field: codes[0] for field, codes in HEADING_MAP.items() if codes
}


# Semantic-name map for newer BeNGAAP / C-ASBL XBRL filings, where
# element local names are full concept names (no NBB heading code
# embedded). Names are taken from real cached filings and reflect the
# quirks NBB ships — note for instance ``CurrentsAssets`` with the
# trailing ``s`` is the actual taxonomy spelling, not a typo on our
# side. Add aliases as you encounter new ones — first match wins.
SEMANTIC_NAME_TO_FIELD: dict[str, str] = {
    # Income statement
    "Turnover": "revenue",
    "NetTurnover": "revenue",
    "OperatingProfitLoss": "operating_profit",
    "GainLossPeriod": "net_profit",
    "GainLossForThePeriod": "net_profit",
    "ProfitLossPeriod": "net_profit",
    "ProfitLossForThePeriod": "net_profit",
    # Balance sheet — assets
    "Assets": "total_assets",
    "TotalAssets": "total_assets",
    "FixedAssets": "fixed_assets",
    "CurrentsAssets": "current_assets",  # actual NBB taxonomy spelling
    "CurrentAssets": "current_assets",
    "Stocks": "inventory",
    "Inventories": "inventory",
    "InventoriesContractsInProgress": "inventory",
    "CashBankHand": "cash_and_equivalents",
    "CashAtBankAndInHand": "cash_and_equivalents",
    "CashAndCashEquivalents": "cash_and_equivalents",
    # Balance sheet — equity & liabilities
    "Equity": "total_equity",
    "TotalEquity": "total_equity",
    "Liabilities": "total_liabilities",
    "TotalLiabilities": "total_liabilities",
    "AmountsPayableAfterOneYear": "long_term_debt",
    "AmountsPayableWithinOneYear": "short_term_debt",
    # Social balance — employees (multiple aliases reported in the
    # same filing all hold the same FTE value, so any of them works)
    "EmployeesRecordedPersonnelRegisterAverageNumberEmployeesCalculatedFullTimeEquivalents": "employees_fte",
    "AverageNumberEmployeesPersonnelRegisterTotalFullTimeEquivalents": "employees_fte",
    "AverageNumberEmployeesFullTimeEquivalents": "employees_fte",
}


class XbrlExtractor:
    """Primary extractor when XBRL is available for a filing."""

    def __init__(self, nbb_client: NBBClient) -> None:
        self._nbb = nbb_client

    def extract(
        self, enterprise_number: str, ref: FilingReference
    ) -> Optional[FinancialStatement]:
        with timed(f"xbrl.extract[{ref.reference}]"):
            try:
                xbrl_bytes = self._nbb.download_xbrl(ref.reference)
            except Exception as exc:  # NBBClientError, network glitches, etc.
                logger.warning("XBRL download failed for %s: %s", ref.reference, exc)
                return None

            if not xbrl_bytes:
                logger.info("XBRL not available for %s; chain will fall through", ref.reference)
                return None

            try:
                root = etree.fromstring(xbrl_bytes)
            except etree.XMLSyntaxError as exc:
                logger.warning("XBRL parse failed for %s: %s", ref.reference, exc)
                return None

            # FIX #2: take ALL contexts for the current fiscal year, not
            # just one. A typical filing has at least two: an "instant"
            # context for the balance-sheet date and a "duration"
            # context for the matching P&L period. The social-balance
            # section (code 9087 et al.) sometimes carries its own
            # context whose endDate differs by a day from the
            # balance-sheet date, so we match on fiscal *year* rather
            # than the exact endDate string. The filing reference gives
            # us the canonical exercise_end to anchor against.
            target_year = ref.exercise_end.year if ref.exercise_end else None
            current_contexts = self._pick_current_contexts(root, target_year)
            if not current_contexts:
                logger.info("XBRL for %s has no datable contexts", ref.reference)
                return None

            facts = self._extract_facts(root, current_contexts)
            if not facts:
                logger.info(
                    "XBRL for %s had no recognised heading-code facts (%d total elements scanned)",
                    ref.reference,
                    sum(1 for _ in root.iter()),
                )
                return None

            statement = _build_statement(
                enterprise_number=enterprise_number,
                ref=ref,
                facts_by_code=facts,
            )

            # FIX #3: post-extraction sanity checks. Non-fatal — we log
            # warnings and let the caller decide whether to retry via
            # the LLM fallback.
            warnings = _validate_accounting_identities(statement)
            for warning in warnings:
                logger.warning("XBRL validation [%s]: %s", ref.reference, warning)

            return statement

    # ── helpers ─────────────────────────────────────────────────────────

    def _pick_current_contexts(
        self,
        root: etree._Element,
        target_year: Optional[int] = None,
    ) -> set[str]:
        """Return all context ids whose period falls in the current fiscal year.

        Belgian XBRL filings include at minimum:
          - one "instant" context for the balance-sheet date (e.g.
            2020-12-31), holding all balance-sheet facts;
          - one "duration" context for the fiscal year (e.g.
            2020-01-01 → 2020-12-31), holding all P&L facts;
          - sometimes a social-balance context whose endDate differs by
            a day (12-30 instead of 12-31) due to how the social-balance
            schema reports averages.

        Matching on the exact endDate string drops the social-balance
        context — and with it code 9087 (average FTE headcount). We
        match on the *year* portion of the endDate instead, which is
        robust to those off-by-one-day quirks.

        When *target_year* is provided we anchor on it. Otherwise we
        infer it from the latest endDate in the document.
        """
        ctx_to_end: dict[str, str] = {}
        for ctx in root.iterfind(f".//{{{_XBRLI_NS}}}context"):
            ctx_id = ctx.get("id")
            if not ctx_id:
                continue
            end_elem = ctx.find(f".//{{{_XBRLI_NS}}}endDate")
            if end_elem is None:
                end_elem = ctx.find(f".//{{{_XBRLI_NS}}}instant")
            if end_elem is None or not end_elem.text:
                continue
            ctx_to_end[ctx_id] = end_elem.text.strip()

        if not ctx_to_end:
            return set()

        if target_year is None:
            latest = max(ctx_to_end.values())
            target_year_str = latest[:4]
        else:
            target_year_str = str(target_year)

        return {
            ctx_id
            for ctx_id, end in ctx_to_end.items()
            if end.startswith(target_year_str)
        }

    def _extract_facts(
        self,
        root: etree._Element,
        current_contexts: set[str],
    ) -> dict[str, Decimal]:
        """Walk every fact in the document and map it to its heading code.

        Returns ``{heading_code: value}`` for facts whose context is in
        the current fiscal year. Facts without ``contextRef`` (e.g.
        unitful "DEI" metadata) are skipped.

        Conflict resolution: if two facts map to the same code with
        different values (rare but possible — e.g. a code restated
        across contexts), we log a warning and keep the first seen.
        """
        # Track all values seen per code so we can detect conflicts.
        seen: dict[str, list[Decimal]] = defaultdict(list)

        for elem in root.iter():
            ctx_ref = elem.get("contextRef")
            if not ctx_ref or ctx_ref not in current_contexts:
                continue

            text = (elem.text or "").strip()
            if not text:
                continue

            raw_value = _parse_xbrl_number(text)
            if raw_value is None:
                continue

            # Apply the `decimals` attribute if present. Negative values
            # indicate scaling: decimals="-3" means the reported number
            # is in thousands. Most BNB filings use decimals="0", but
            # we handle the general case to be safe.
            value = _apply_decimals_scaling(raw_value, elem.get("decimals"))

            local_name = _local(elem.tag)
            code = _code_for(local_name, ctx_ref)
            if code is None:
                continue
            seen[code].append(value)

        out: dict[str, Decimal] = {}
        for code, values in seen.items():
            unique = sorted(set(values))
            if len(unique) > 1:
                # Conflict resolution: keep the value with the largest
                # absolute magnitude. Heuristic but reliable on Belgian
                # filings — a prior-year restatement is usually smaller
                # than the current-year final, and multi-period
                # aggregates (rare) tend to be larger still. Prevents
                # the "document order wins" bug where code 9087's
                # prior-year value silently overwrote the current.
                chosen = max(values, key=lambda v: abs(v))
                logger.warning(
                    "XBRL fact code %s had conflicting values %s; "
                    "keeping the largest by magnitude (%s)",
                    code,
                    unique,
                    chosen,
                )
                out[code] = chosen
            else:
                out[code] = values[0]
        return out


# ── module-level helpers (testable in isolation) ────────────────────────


def _code_for(local_name: str, context_ref: Optional[str] = None) -> Optional[str]:
    """Find the heading code (or synthetic canonical code) for a fact.

    Two strategies, tried in order:

      1. **Digit-based scan of the element local name.** Older
         BeNGAAP taxonomy versions name elements like
         ``HeadingCode_20_28`` or ``Code70_Turnover``.

      2. **Semantic-name lookup.** The newer NBB taxonomy (C-ASBL and
         recent VOL filings) uses purely semantic element names —
         ``Turnover``, ``Equity``, ``CashBankHand`` — with no digits.
         We map these via :data:`SEMANTIC_NAME_TO_FIELD` and return
         the canonical code for that field so the rest of the
         pipeline keeps working.

    *We deliberately do NOT scan the ``contextRef``.* A previous
    revision tried that as a third strategy, but dimensional XBRL
    filings (where contexts are named ``c1``, ``c2``, ... ``c185``)
    produce false-positive matches whenever a context id digit-run
    happens to equal an NBB heading code (e.g. ``c70`` was mis-mapped
    to ``revenue``). The ``contextRef`` ``c70`` carries no NBB code —
    it's just a sequential ID — but the regex couldn't tell the
    difference.

    FIX #1: when multiple digit-runs match in the local name (e.g.
    ``Code_620_Detail`` contains both ``620`` and could superficially
    match ``62``), prefer the *longest* candidate.

    The ``context_ref`` parameter is kept on the signature for call-site
    compatibility but ignored.
    """
    del context_ref  # Intentionally unused — see docstring.

    candidates: list[str] = []
    for match in _CODE_RE.finditer(local_name):
        candidate = match.group(1).replace("_", "/")
        if candidate in _CODE_TO_FIELD:
            candidates.append(candidate)
    if candidates:
        # Longest wins. Ties broken by first occurrence (stable sort).
        return max(candidates, key=lambda c: (len(c), -candidates.index(c)))

    # Fall through to semantic-name lookup.
    field = SEMANTIC_NAME_TO_FIELD.get(local_name)
    if field is not None:
        return _FIELD_TO_CANONICAL_CODE.get(field)
    return None


def _apply_decimals_scaling(value: Decimal, decimals_attr: Optional[str]) -> Decimal:
    """Apply the XBRL ``decimals`` attribute as a power-of-ten scaling.

    The XBRL spec defines ``decimals`` as the number of digits to the
    right of the decimal point that are accurate. Negative values
    indicate truncation: decimals="-3" means accurate to the nearest
    thousand, so a reported "1996" should be read as 1_996_000.

    In practice BNB filings almost always use decimals="0" (exact
    euros). We handle the general case defensively.
    """
    if decimals_attr is None or decimals_attr == "INF":
        return value
    try:
        d = int(decimals_attr)
    except ValueError:
        return value
    if d >= 0:
        return value
    return value * (Decimal(10) ** (-d))


def _build_statement(
    *,
    enterprise_number: str,
    ref: FilingReference,
    facts_by_code: dict[str, Decimal],
) -> FinancialStatement:
    """Construct a :class:`FinancialStatement` from the matched codes.

    Walks :data:`HEADING_MAP` in declaration order — for each field, the
    first matching code wins, mirroring the regex extractor's
    fallback-chain semantics.
    """
    fields: dict[str, Optional[Decimal]] = {}
    for field, codes in HEADING_MAP.items():
        chosen: Optional[Decimal] = None
        for code in codes:
            if code in facts_by_code:
                chosen = facts_by_code[code]
                break
        fields[field] = chosen

    # Keep the raw code -> value map so downstream callers can inspect
    # extras (Decimal-serialisable for Supabase's jsonb column).
    raw = dict(facts_by_code)

    return FinancialStatement(
        enterprise_number=enterprise_number,
        reference=ref.reference,
        fiscal_year=ref.fiscal_year,
        exercise_start=ref.exercise_start,
        exercise_end=ref.exercise_end,
        source=FilingFormat.XBRL,
        raw_headings=raw,
        **fields,
    )


def _validate_accounting_identities(stmt: FinancialStatement) -> list[str]:
    """Run balance-sheet identity checks; return human-readable warnings.

    These identities must hold within rounding tolerance on every
    well-formed Belgian filing:

      1. Total assets       = Fixed assets + Current assets
      2. Total assets       = Total equity + Total liabilities + Provisions
      3. Total liabilities  = Long-term debt + Short-term debt

    A breach indicates either (a) an extraction bug (wrong code
    mapped) or (b) a unit-scaling problem (some facts in thousands,
    some in units). Either way, it's a signal worth surfacing.

    Returns an empty list when the statement is internally consistent
    OR when too many components are missing to run the check.
    """
    warnings: list[str] = []

    def _diff(left: Decimal, right: Decimal) -> Decimal:
        return abs(left - right)

    # Identity 1: total_assets = fixed_assets + current_assets
    if all(
        getattr(stmt, f, None) is not None
        for f in ("total_assets", "fixed_assets", "current_assets")
    ):
        expected = stmt.fixed_assets + stmt.current_assets
        drift = _diff(stmt.total_assets, expected)
        if drift > _VALIDATION_TOLERANCE:
            warnings.append(
                f"Balance-sheet identity 1 violated: total_assets={stmt.total_assets} "
                f"vs fixed+current={expected} (drift={drift})"
            )

    # Identity 2: total_assets = total_equity + total_liabilities + provisions
    # We tolerate missing provisions (defaults to 0) since not all
    # filings break it out.
    if all(
        getattr(stmt, f, None) is not None
        for f in ("total_assets", "total_equity", "total_liabilities")
    ):
        provisions = getattr(stmt, "provisions", None) or Decimal(0)
        expected = stmt.total_equity + stmt.total_liabilities + provisions
        drift = _diff(stmt.total_assets, expected)
        if drift > _VALIDATION_TOLERANCE:
            warnings.append(
                f"Balance-sheet identity 2 violated: total_assets={stmt.total_assets} "
                f"vs equity+liab+prov={expected} (drift={drift})"
            )

    # Identity 3: total_liabilities = long_term_debt + short_term_debt
    # Treat missing legs as zero only when at least one is present.
    if stmt.total_liabilities is not None and (
        stmt.long_term_debt is not None or stmt.short_term_debt is not None
    ):
        lt = stmt.long_term_debt or Decimal(0)
        st = stmt.short_term_debt or Decimal(0)
        expected = lt + st
        drift = _diff(stmt.total_liabilities, expected)
        if drift > _VALIDATION_TOLERANCE:
            warnings.append(
                f"Liability split violated: total_liabilities={stmt.total_liabilities} "
                f"vs long+short={expected} (drift={drift})"
            )

    return warnings