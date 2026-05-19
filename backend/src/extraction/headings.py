"""NBB standardised accounting heading codes.

Belgian filings follow a fixed chart of accounts published by the
Central Balance Sheet Office. Each line item is identified by a
numeric code that is stable across filings, which makes structured
extraction tractable. The codes below cover the line items we expose
in :class:`FinancialStatement` for both the full (C-models) and
abbreviated (A-models) schemas.

Reference: NBB Annexes "Tableau de correspondance des rubriques"
(https://www.nbb.be/en/central-balance-sheet-office/drawing-up/models).
"""

from __future__ import annotations

# Each tuple lists fallbacks ordered from most preferred to least preferred.
HEADING_MAP: dict[str, tuple[str, ...]] = {
    "revenue": ("70",),
    "operating_profit": ("9901",),
    "net_profit": ("9904",),
    "total_assets": ("20/58",),
    "fixed_assets": ("20/28", "21/28"),
    "current_assets": ("29/58",),
    "total_equity": ("10/15",),
    "total_liabilities": ("17/49", "16"),
    "long_term_debt": ("17",),
    "short_term_debt": ("42/48",),
    "cash_and_equivalents": ("54/58",),
    "employees_fte": ("9087", "1003"),
    # Inventories ("Stocks and contracts in progress"). Full-schema filings
    # break this out as 30/36; abbreviated-schema filings collapse it to "3".
    "inventory": ("3", "30/36"),
    # Depreciation, amortisation and impairment of formation expenses,
    # intangible and tangible fixed assets. Required to approximate
    # operating cash flow (CFO ≈ Net Profit + Depreciation).
    "depreciation": ("630",),
}
