from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class FilingFormat(str, Enum):
    XBRL = "xbrl"
    PDF = "pdf"
    UNKNOWN = "unknown"


class NaceCode(BaseModel):
    """One Nacebel activity classification entry.

    KBO publishes several parallel classifications per enterprise: one
    per source (VAT / NSSO / EDRL) and per Nacebel version year
    (2003 / 2008 / 2025). A company therefore typically has multiple
    NaceCode entries representing the same business activity under
    different schemes.
    """

    code: str = Field(description="Numeric code, e.g. '47.11' or '74.999'")
    description: Optional[str] = None
    source: Optional[str] = Field(default=None, description="VAT, NSSO or EDRL")
    version: Optional[int] = Field(default=None, description="Nacebel version year")
    since: Optional[date] = None


class Function(BaseModel):
    """A role held within the company (director, manager, etc.).

    On KBO public search natural-person holders are often shown only
    as a name string; legal-entity holders carry their own CBE number.
    """

    role: str
    holder_name: Optional[str] = None
    holder_enterprise_number: Optional[str] = None
    since: Optional[date] = None


class Company(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    enterprise_number: str = Field(description="10-digit BCE/KBO/CBE number, no dots")
    name: Optional[str] = Field(
        default=None,
        description="Legal name from KBO; None when the pipeline skipped KBO (direct CBE input).",
    )
    trade_name: Optional[str] = None
    legal_form: Optional[str] = None
    address: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[date] = None
    dissolution_date: Optional[date] = None
    vat_subject: Optional[bool] = Field(
        default=None,
        description="Whether the company is registered as subject to VAT (from KBO Characteristics).",
    )
    nace_codes: list[NaceCode] = Field(default_factory=list)
    functions: list[Function] = Field(default_factory=list)


class FilingReference(BaseModel):
    reference: str = Field(description="NBB filing reference identifier")

    deposit_date: Optional[date] = None
    exercise_start: Optional[date] = None
    exercise_end: Optional[date] = None
    model_type: Optional[str] = Field(
        default=None, description="NBB filing model code (e.g. C 1.1, A 1.1)"
    )
    language: Optional[str] = None
    accounting_format: FilingFormat = FilingFormat.UNKNOWN

    @property
    def fiscal_year(self) -> Optional[int]:
        return self.exercise_end.year if self.exercise_end else None


class FinancialStatement(BaseModel):
    """Normalised financial snapshot for a single filing.

    Values are in EUR. Anything not present in the filing is left None
    rather than zero so callers can distinguish missing from zero.
    """

    enterprise_number: str
    reference: str
    fiscal_year: Optional[int] = None
    exercise_start: Optional[date] = None
    exercise_end: Optional[date] = None
    currency: str = "EUR"

    revenue: Optional[Decimal] = Field(default=None, description="Turnover / net sales")
    operating_profit: Optional[Decimal] = None
    net_profit: Optional[Decimal] = Field(default=None, description="Profit/loss for the period")

    total_assets: Optional[Decimal] = None
    fixed_assets: Optional[Decimal] = None
    current_assets: Optional[Decimal] = None

    total_equity: Optional[Decimal] = None
    total_liabilities: Optional[Decimal] = None
    long_term_debt: Optional[Decimal] = None
    short_term_debt: Optional[Decimal] = None

    cash_and_equivalents: Optional[Decimal] = None
    inventory: Optional[Decimal] = Field(
        default=None,
        description="Inventories and contracts in progress (NBB code '3' / '30/36'). "
        "Needed to derive the Quick Ratio = (current_assets - inventory) / current_liabilities.",
    )
    depreciation: Optional[Decimal] = Field(
        default=None,
        description="Depreciation, amortisation and impairment on fixed assets (NBB code '630'). "
        "Used to approximate operating cash flow (Net Profit + Depreciation).",
    )
    employees_fte: Optional[Decimal] = None

    source: FilingFormat = FilingFormat.UNKNOWN
    raw_headings: dict[str, Decimal] = Field(
        default_factory=dict,
        description="All raw accounting headings keyed by NBB code (e.g. '70', '20/58')",
    )


class CompanyFinancialReport(BaseModel):
    company: Company
    filings: list[FilingReference]
    statements: list[FinancialStatement]
