"""End-to-end orchestrator: company name -> CBE number -> filings -> financials."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, Optional

from src._timing import timed
from src.config import Settings, settings as default_settings
from src.extraction import build_extractor
from src.kbo import KBOScraper
from src.models import Company, CompanyFinancialReport
from src.nbb import NBBClient

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str], None]


@dataclass(slots=True)
class PipelineConfig:
    filings_to_read: int = 2


class EnrichmentPipeline:
    def __init__(
        self,
        *,
        settings: Settings | None = None,
        config: PipelineConfig | None = None,
    ) -> None:
        self._settings = settings or default_settings
        self._config = config or PipelineConfig()

    def run(
        self,
        query: str,
        on_progress: Optional[ProgressCallback] = None,
        *,
        filings_to_read: Optional[int] = None,
    ) -> CompanyFinancialReport:
        """Resolve *query* into a :class:`CompanyFinancialReport`.

        Args:
            query: Name or 10-digit CBE.
            on_progress: Optional per-step progress hook.
            filings_to_read: Override for ``PipelineConfig.filings_to_read``
                so the API can pass a per-request value without rebuilding
                the singleton pipeline.
        """
        with timed("pipeline.total"):
            return self._run(query, on_progress, filings_to_read)

    def _run(
        self,
        query: str,
        on_progress: Optional[ProgressCallback],
        filings_to_read: Optional[int],
    ) -> CompanyFinancialReport:
        notify = on_progress or (lambda _msg: None)
        n_filings = (
            filings_to_read
            if filings_to_read is not None
            else self._config.filings_to_read
        )

        notify("Resolving company in KBO")
        company = self._resolve_company(query)
        logger.info(
            "Resolved %r -> %s (%s)",
            query,
            company.name or "<name unknown, KBO skipped>",
            company.enterprise_number,
        )

        with NBBClient(
            base_url=self._settings.nbb_api_base_url,
            subscription_key=self._settings.nbb_api_subscription_key,
            cache_dir=self._settings.cache_dir,
            timeout=self._settings.http_timeout,
            deposit_path=self._settings.nbb_deposit_path,
        ) as nbb:
            notify("Fetching filing references from NBB")
            references = nbb.latest_references(
                company.enterprise_number, limit=n_filings
            )
            logger.info(
                "Fetched %d filing reference(s) for %s",
                len(references),
                company.enterprise_number,
            )

            extractor = build_extractor(nbb)
            chain_label = "XBRL → " + (
                f"LLM ({self._settings.openai_model}) → regex"
                if self._settings.has_openai_credentials
                else "regex"
            )
            notify(f"Extractor chain: {chain_label}")
            logger.info("Using chain: %s", chain_label)

            statements = []
            for i, ref in enumerate(references, 1):
                notify(f"Extracting filing {i}/{len(references)} (ref {ref.reference})")
                stmt = extractor.extract(company.enterprise_number, ref)
                if stmt is not None:
                    statements.append(stmt)

        notify("Done")
        return CompanyFinancialReport(
            company=company, filings=references, statements=statements
        )

    def _resolve_company(self, query: str) -> Company:
        """Return a :class:`Company` for *query*.

        ``KBOScraper.lookup`` handles both forms: when *query* is already
        a valid 10-digit enterprise number it skips the name search and
        fetches the KBO detail page directly (one HTTP call). When *query*
        is a name it does the phonetic search first, then the detail page.

        Either way the returned :class:`Company` carries the legal profile
        (NACE codes, functions, characteristics) — number-based input no
        longer short-circuits past KBO. If KBO is unreachable, the call
        raises ``CompanyNotFoundError`` and the pipeline aborts.
        """
        with KBOScraper(timeout=self._settings.http_timeout) as kbo, timed("kbo.lookup_total"):
            return kbo.lookup(query)
