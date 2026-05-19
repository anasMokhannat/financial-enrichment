"""Client for the NBB Central Balance Sheet Office Authentic Data Query API.

Documentation: https://www.nbb.be/en/central-balance-sheet-office/consultation/web-services/authentic-data-query

This API exposes:

* List of filing references for an enterprise (CBE) number.
* Per-reference document download as PDF, XBRL or JSON.
  JSON is only available for filings published from 2022-04-04 onwards.

Endpoint paths and authentication header names below mirror the
NBB developer-portal layout. Subscription keys and the exact base
URL must be configured via environment variables; the user obtains
them from the NBB after submitting the order form.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from src._timing import timed
from src.exceptions import NBBClientError
from src.models import FilingFormat, FilingReference

REFERENCES_PATH = "/legalEntity/{cbe}/references"
DEPOSIT_PATH = "/deposit/{reference}/accountingData"

# Content-negotiation: NBB returns PDF or XBRL from the same deposit
# endpoint depending on the Accept header. NBB's API uses the vendor-
# specific MIME ``application/x.xbrl`` (not the IETF standard
# ``application/xbrl+xml``) — sending the wrong value gets you the
# PDF back regardless of intent.
ACCEPT_PDF = "application/pdf"
ACCEPT_XBRL = "application/x.xbrl"


class NBBNotFoundError(NBBClientError):
    """NBB returned 404 — the entity isn't registered with CBSO or has
    no published filings under this CBE. A legitimate "no data" state,
    not an upstream error."""


class NBBClient:
    def __init__(
        self,
        base_url: str,
        subscription_key: str,
        *,
        cache_dir: Optional[Path] = None,
        timeout: float = 30.0,
        client: Optional[httpx.Client] = None,
        deposit_path: str = DEPOSIT_PATH,
    ) -> None:
        if not subscription_key:
            raise NBBClientError(
                "NBB_API_SUBSCRIPTION_KEY is not set. Request access at "
                "https://www.nbb.be/en/central-balance-sheet-office/consultation/web-services."
            )
        self._base_url = base_url.rstrip("/")
        self._deposit_path = deposit_path
        # Best-effort cache-dir creation. On serverless platforms only
        # /tmp is writable; on a misconfigured deploy the default `.cache`
        # path triggers EROFS. Disable the on-disk cache in that case
        # rather than failing the whole pipeline — Supabase is the
        # durable store, the PDF cache is just a speed-up.
        if cache_dir:
            try:
                cache_dir.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                logger.warning(
                    "Could not create NBB cache_dir at %s (%s); "
                    "continuing without on-disk PDF cache.",
                    cache_dir,
                    exc,
                )
                cache_dir = None
        self._cache_dir = cache_dir

        self._owns_client = client is None
        self._client = client or httpx.Client(
            base_url=self._base_url,
            timeout=timeout,
            headers={
                "NBB-CBSO-Subscription-Key": subscription_key,
                "X-Request-id": "930a676e-bcad-4558-8fca-831b3adea165", 
                "Accept": "application/json",
                "User-Agent": "legal-financial-enrichment/0.1",
            },
        )

    def __enter__(self) -> "NBBClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def list_references(self, enterprise_number: str) -> list[FilingReference]:
        """Return every filing reference NBB knows about for this CBE.

        Both flavours of "no data" surface as an empty list rather than
        an exception:

        - ``404`` from NBB: the entity isn't in CBSO at all (small or
          brand-new company; foreign entity; numbering mismatch).
        - ``200`` with an empty payload: registered but has never
          deposited an annual filing.

        Pipeline callers iterate the returned list, so an empty list
        cleanly produces a report with an empty ``statements`` section.
        """
        cbe = _digits(enterprise_number)
        with timed("nbb.list_references"):
            try:
                payload = self._get_json(REFERENCES_PATH.format(cbe=cbe))
            except NBBNotFoundError:
                return []

        items = _coerce_reference_list(payload)
        if not items:
            return []

        refs = [_parse_reference(item) for item in items]
        refs.sort(
            key=lambda r: (
                r.exercise_end or r.deposit_date or date.min,
                r.deposit_date or date.min,
            ),
            reverse=True,
        )
        return _deduplicate(refs)

    def latest_references(
        self, enterprise_number: str, *, limit: int = 2
    ) -> list[FilingReference]:
        return self.list_references(enterprise_number)[:limit]

    def download_pdf(self, reference: str) -> bytes:
        cached = self._cache_path(reference, "pdf")
        if cached and cached.exists():
            with timed(f"nbb.pdf_cache_hit[{reference}]"):
                return cached.read_bytes()

        with timed(f"nbb.pdf_download[{reference}]"):
            resp = self._raw_get(
                self._deposit_path.format(reference=reference),
                headers={"Accept": ACCEPT_PDF},
            )
        _try_cache_write(cached, resp.content)
        return resp.content

    def download_xbrl(self, reference: str) -> Optional[bytes]:
        """Fetch the XBRL document for a filing, or ``None`` if absent.

        Same deposit endpoint as :meth:`download_pdf` — the format is
        chosen via the ``Accept`` header (content negotiation).

        Coverage:
        - Full-schema (VOL) filings: XBRL since 2007.
        - Abbreviated / micro: spotty coverage.

        Three "not available" cases all surface as ``None`` (so the
        chain extractor falls through cleanly) — but each is logged
        distinctly so the operator can tell them apart:

        1. **404** — NBB has no XBRL for this filing.
        2. **PDF returned for XBRL request** — NBB ignored the Accept
           header (subscription tier doesn't support XBRL on this
           endpoint). The bytes start with ``%PDF`` instead of ``<``.
        3. **Unexpected content type** — anything else non-XML.
        """
        cached = self._cache_path(reference, "xbrl")
        if cached and cached.exists():
            with timed(f"nbb.xbrl_cache_hit[{reference}]"):
                return cached.read_bytes()

        try:
            with timed(f"nbb.xbrl_download[{reference}]"):
                resp = self._raw_get(
                    self._deposit_path.format(reference=reference),
                    headers={"Accept": ACCEPT_XBRL},
                )
        except NBBNotFoundError:
            logger.info("XBRL not available for %s (NBB returned 404)", reference)
            return None

        content = resp.content
        content_type = resp.headers.get("Content-Type", "")
        head = content[:8] if content else b""

        if head.startswith(b"%PDF"):
            logger.warning(
                "NBB ignored the XBRL Accept header for %s and returned PDF "
                "(Content-Type: %s). Your subscription tier may not expose XBRL on this endpoint.",
                reference,
                content_type,
            )
            return None

        if not head.lstrip().startswith((b"<", b"\xef\xbb\xbf<")):
            logger.warning(
                "XBRL response for %s does not look like XML (first 8 bytes: %r, "
                "Content-Type: %s). Falling through.",
                reference,
                head,
                content_type,
            )
            return None

        _try_cache_write(cached, content)
        return content

    def fetch_accounting_json(self, reference: str) -> Optional[dict]:
        """Return the structured accounting JSON for a filing.

        The accountingData endpoint currently only serves PDF responses.
        JSON structured data is not available, so this always returns None
        and the caller falls back to PDF extraction.
        """
        return None

    @retry(
        retry=retry_if_exception_type((httpx.HTTPError,)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, max=4),
        reraise=True,
    )
    def _raw_get(self, path: str, *, headers: Optional[dict] = None) -> httpx.Response:
        resp = self._client.get(path, headers=headers)
        if resp.status_code == 404:
            raise NBBNotFoundError(
                f"NBB API 404 on {path}: {resp.text[:200]}"
            )
        if resp.status_code >= 400:
            raise NBBClientError(
                f"NBB API {resp.status_code} on {path}: {resp.text[:200]}"
            )
        return resp

    def _get_json(self, path: str) -> dict | list:
        resp = self._raw_get(path, headers={"Accept": "application/json"})
        try:
            return resp.json()
        except ValueError as exc:
            raise NBBClientError(f"Non-JSON response from {path}") from exc

    def _cache_path(self, reference: str, ext: str) -> Optional[Path]:
        if not self._cache_dir:
            return None
        safe = reference.replace("/", "_").replace("\\", "_")
        return self._cache_dir / f"{safe}.{ext}"


def _try_cache_write(path: Optional[Path], data: bytes) -> None:
    """Write *data* to *path* on a best-effort basis.

    The on-disk cache is a speed-up, not a correctness requirement —
    Supabase is the durable store. Serverless platforms like Vercel
    only expose ``/tmp`` as writable, so a misconfigured cache dir
    must not break the request. We log and move on.
    """
    if path is None:
        return
    try:
        path.write_bytes(data)
    except OSError as exc:
        logger.warning("Skipping cache write at %s (%s)", path, exc)


def _digits(num: str) -> str:
    return "".join(c for c in num if c.isdigit())


def _coerce_reference_list(payload: dict | list) -> list[dict]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("references", "items", "data", "results"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def _deduplicate(refs: list[FilingReference]) -> list[FilingReference]:
    """Keep only the most recently deposited filing per fiscal period.

    When a company re-files (correction), both the initial and corrected
    filings share the same exercise period. Since *refs* is already sorted
    by (exercise_end, deposit_date) descending, the first entry per period
    is the one we want.
    """
    seen: set[tuple] = set()
    out: list[FilingReference] = []
    for ref in refs:
        key = (ref.exercise_start, ref.exercise_end)
        if key in seen:
            continue
        seen.add(key)
        out.append(ref)
    return out


def _parse_reference(item: dict) -> FilingReference:
    raw_format = (item.get("AccountingDataURL") or item.get("format") or "").lower()
    if "xbrl" in raw_format or item.get("hasXbrl") or item.get("xbrlAvailable"):
        fmt = FilingFormat.XBRL
    elif item.get("hasPdf") is False:
        fmt = FilingFormat.UNKNOWN
    else:
        fmt = FilingFormat.PDF

    return FilingReference(
        reference=str(
            item.get("ReferenceNumber")
            or item.get("reference")
            or item.get("id")
            or ""
        ),
        deposit_date=_to_date(item.get("DepositDate") or item.get("depositDate")),
        exercise_start=_to_date(
            item.get("ExerciseDates", {}).get("startDate")
            if isinstance(item.get("ExerciseDates"), dict)
            else item.get("exerciseStartDate") or item.get("startDate")
        ),
        exercise_end=_to_date(
            item.get("ExerciseDates", {}).get("endDate")
            if isinstance(item.get("ExerciseDates"), dict)
            else item.get("exerciseEndDate") or item.get("endDate")
        ),
        model_type=item.get("ModelType") or item.get("modelType"),
        language=item.get("Language") or item.get("language"),
        accounting_format=fmt,
    )


def _to_date(value: object) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        text = value.strip()[:19]
        for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y", "%d.%m.%Y"):
            try:
                return datetime.strptime(text, fmt).date()
            except ValueError:
                continue
    return None


def latest_n(refs: Iterable[FilingReference], n: int) -> list[FilingReference]:
    return list(refs)[:n]
