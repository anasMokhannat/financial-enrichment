"""Repository for the public enrichment tables.

These tables hold reference data we pull from KBO and NBB — public
information that anyone could look up themselves. The repository
exposes upserts (idempotent re-ingestion) and reads.

Writes are intended to be called from the backend with a service-role
client; RLS denies non-service-role writes.
"""

from __future__ import annotations

import logging
from typing import Optional

from supabase import Client

from src.models import (
    Company,
    CompanyFinancialReport,
    FilingFormat,
    FilingReference,
    FinancialStatement,
    Function,
    NaceCode,
)

from ._serde import to_row, to_rows

logger = logging.getLogger(__name__)


class EnrichmentRepository:
    def __init__(self, client: Client) -> None:
        self._client = client

    # ── Writes ──────────────────────────────────────────────────────────

    def upsert_company(self, company: Company) -> None:
        row = to_row(company, exclude_none=True)
        # nace_codes / functions live in their own tables — strip them
        # off the company row before the upsert.
        row.pop("nace_codes", None)
        row.pop("functions", None)
        (
            self._client.table("companies")
            .upsert(row, on_conflict="enterprise_number")
            .execute()
        )

    def replace_nace_codes(
        self, enterprise_number: str, codes: list[NaceCode]
    ) -> None:
        """NACE entries are a fact-table per company — full replace on each
        refresh is simpler and more correct than diffing."""
        self._client.table("nace_codes").delete().eq(
            "enterprise_number", enterprise_number
        ).execute()
        if not codes:
            return
        rows = to_rows(codes)
        for r in rows:
            r["enterprise_number"] = enterprise_number
        self._client.table("nace_codes").insert(rows).execute()

    def replace_functions(
        self, enterprise_number: str, functions: list[Function]
    ) -> None:
        self._client.table("functions").delete().eq(
            "enterprise_number", enterprise_number
        ).execute()
        if not functions:
            return
        rows = to_rows(functions)
        for r in rows:
            r["enterprise_number"] = enterprise_number
        self._client.table("functions").insert(rows).execute()

    def upsert_filing_references(
        self, enterprise_number: str, refs: list[FilingReference]
    ) -> None:
        if not refs:
            return
        rows = to_rows(refs)
        for r in rows:
            r["enterprise_number"] = enterprise_number
            # The Pydantic field is `accounting_format`; the SQL column is
            # the same. Coerce the enum value to its string form.
            af = r.get("accounting_format")
            if isinstance(af, FilingFormat):
                r["accounting_format"] = af.value
            r.pop("fiscal_year", None)  # computed property, not a column
        self._client.table("filing_references").upsert(
            rows, on_conflict="reference"
        ).execute()

    def upsert_financial_statement(
        self, statement: FinancialStatement, *, extractor: str
    ) -> None:
        row = to_row(statement, exclude_none=False)
        row["extractor"] = extractor
        # The Pydantic field 'source' is an enum; serialise to plain value.
        if isinstance(statement.source, FilingFormat):
            row["source"] = statement.source.value
        self._client.table("financial_statements").upsert(
            row, on_conflict="reference"
        ).execute()

    def save_report(
        self, report: CompanyFinancialReport, *, extractor: str
    ) -> None:
        """Persist a full :class:`CompanyFinancialReport` in one logical save.

        Order matters because of foreign keys: company first, then the
        children (NACE, functions, filings) which all FK to it, then
        the statements which FK to filings.
        """
        self.upsert_company(report.company)
        self.replace_nace_codes(
            report.company.enterprise_number, report.company.nace_codes
        )
        self.replace_functions(
            report.company.enterprise_number, report.company.functions
        )
        self.upsert_filing_references(
            report.company.enterprise_number, report.filings
        )
        for statement in report.statements:
            self.upsert_financial_statement(statement, extractor=extractor)

    # ── Reads ───────────────────────────────────────────────────────────

    def get_company(self, enterprise_number: str) -> Optional[Company]:
        resp = (
            self._client.table("companies")
            .select("*, nace_codes(*), functions(*)")
            .eq("enterprise_number", enterprise_number)
            .maybe_single()
            .execute()
        )
        # supabase-py 2.7.x returns None (not an empty APIResponse) from
        # `.maybe_single().execute()` when no row matches. Handle both
        # shapes so the function stays compatible across SDK versions.
        if resp is None or not resp.data:
            return None
        data = resp.data
        # The SDK returns embedded relations as nested lists; pluck them
        # into the Company model.
        nace = [NaceCode(**c) for c in (data.pop("nace_codes", None) or [])]
        funcs = [Function(**f) for f in (data.pop("functions", None) or [])]
        # Audit columns aren't part of the Pydantic model.
        data.pop("first_seen_at", None)
        data.pop("last_refreshed_at", None)
        return Company(**data, nace_codes=nace, functions=funcs)

    def get_filings(self, enterprise_number: str) -> list[FilingReference]:
        resp = (
            self._client.table("filing_references")
            .select("*")
            .eq("enterprise_number", enterprise_number)
            .order("exercise_end", desc=True)
            .execute()
        )
        rows = resp.data or []
        for r in rows:
            r.pop("enterprise_number", None)
            r.pop("fetched_at", None)
        return [FilingReference(**r) for r in rows]

    def get_statements(self, enterprise_number: str) -> list[FinancialStatement]:
        resp = (
            self._client.table("financial_statements")
            .select("*")
            .eq("enterprise_number", enterprise_number)
            .order("fiscal_year", desc=True)
            .execute()
        )
        rows = resp.data or []
        out = []
        for r in rows:
            # Strip audit / metadata columns that aren't on the model.
            r.pop("extractor", None)
            r.pop("extracted_at", None)
            out.append(FinancialStatement(**r))
        return out

    def get_report(
        self, enterprise_number: str
    ) -> Optional[CompanyFinancialReport]:
        """Return a fully assembled :class:`CompanyFinancialReport` or None."""
        company = self.get_company(enterprise_number)
        if company is None:
            return None
        filings = self.get_filings(enterprise_number)
        statements = self.get_statements(enterprise_number)
        return CompanyFinancialReport(
            company=company, filings=filings, statements=statements
        )

    # ── List / stats ────────────────────────────────────────────────────

    def list_companies(
        self, *, limit: int = 50, offset: int = 0
    ) -> tuple[list[dict], int]:
        """Paginated list of companies for the /companies index page.

        Returns ``(items, total)``. The item dicts carry the audit
        columns (``last_refreshed_at``) that the lightweight list view
        renders but the :class:`Company` model intentionally drops.
        Caller pages by passing ``offset = page * limit``.
        """
        resp = (
            self._client.table("companies")
            .select(
                "enterprise_number,name,trade_name,legal_form,status,"
                "dissolution_date,last_refreshed_at",
                count="exact",
            )
            .order("last_refreshed_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        items = resp.data or []
        total = resp.count if resp.count is not None else len(items)
        return items, total

    def count_companies(self) -> int:
        resp = (
            self._client.table("companies")
            .select("enterprise_number", count="exact")
            .limit(0)
            .execute()
        )
        return resp.count or 0

    def count_statements(self) -> int:
        resp = (
            self._client.table("financial_statements")
            .select("reference", count="exact")
            .limit(0)
            .execute()
        )
        return resp.count or 0

    def latest_extraction_at(self) -> Optional[str]:
        """ISO timestamp of the most recent statement extraction."""
        resp = (
            self._client.table("financial_statements")
            .select("extracted_at")
            .order("extracted_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0]["extracted_at"] if rows else None

    def statement_counts_by_enterprise(
        self, enterprise_numbers: list[str]
    ) -> dict[str, int]:
        """Bulk count helper for the list page.

        PostgREST doesn't expose GROUP BY in the URL DSL, so we fetch
        the reference rows for the requested CBE set and count in
        Python. Cheap as long as the page size stays small (50 rows
        means a few hundred references at most).
        """
        if not enterprise_numbers:
            return {}
        resp = (
            self._client.table("financial_statements")
            .select("enterprise_number")
            .in_("enterprise_number", enterprise_numbers)
            .execute()
        )
        counts: dict[str, int] = {}
        for row in resp.data or []:
            cbe = row["enterprise_number"]
            counts[cbe] = counts.get(cbe, 0) + 1
        return counts
