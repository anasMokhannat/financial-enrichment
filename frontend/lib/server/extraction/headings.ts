/**
 * NBB standardised accounting heading codes.
 *
 * Direct port of backend/src/extraction/headings.py. Each value is a
 * fallback chain ordered most → least preferred — the first code with
 * a populated fact wins. Codes are stable across taxonomy versions,
 * which is why this lookup table works at all.
 *
 * Reference: NBB Annexes "Tableau de correspondance des rubriques"
 * (https://www.nbb.be/en/central-balance-sheet-office/drawing-up/models).
 */

export const HEADING_MAP: Record<string, readonly string[]> = {
  revenue: ["70"],
  operating_profit: ["9901"],
  net_profit: ["9904"],
  total_assets: ["20/58"],
  fixed_assets: ["20/28", "21/28"],
  current_assets: ["29/58"],
  total_equity: ["10/15"],
  total_liabilities: ["17/49", "16"],
  long_term_debt: ["17"],
  short_term_debt: ["42/48"],
  cash_and_equivalents: ["54/58"],
  employees_fte: ["9087", "1003"],
  // Full-schema filings break inventory out as 30/36; abbreviated-schema
  // collapse it to "3".
  inventory: ["3", "30/36"],
  // Depreciation, amortisation, impairment of formation expenses,
  // intangible and tangible fixed assets. Needed to approximate
  // operating cash flow (CFO ≈ Net Profit + Depreciation).
  depreciation: ["630"],
};

/**
 * Inverted map: NBB code → FinancialStatement field. Used by the XBRL
 * extractor to decide if a fact's element local name carries a code
 * we care about.
 */
export const CODE_TO_FIELD: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [field, codes] of Object.entries(HEADING_MAP)) {
    for (const code of codes) {
      // XBRL element names sometimes use "_" where the canonical form
      // uses "/", since "/" is illegal in XML local names.
      if (out[code] === undefined) out[code] = field;
      const underscored = code.replace(/\//g, "_");
      if (out[underscored] === undefined) out[underscored] = field;
    }
  }
  return out;
})();

/**
 * Field → canonical (first) NBB code. Used when we match a fact by
 * semantic name rather than by embedded code — we inject the canonical
 * code into the facts dict so the downstream build step (keyed on
 * codes) finds it.
 */
export const FIELD_TO_CANONICAL_CODE: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [field, codes] of Object.entries(HEADING_MAP)) {
    if (codes.length > 0) out[field] = codes[0];
  }
  return out;
})();

/**
 * Semantic-name map for newer BeNGAAP / C-ASBL XBRL filings, where
 * element local names are full concept names (no NBB heading code
 * embedded). Names are from real cached filings — `CurrentsAssets`
 * with the trailing `s` is the actual NBB taxonomy spelling, not a
 * typo. Add aliases as new ones surface; first match wins.
 */
export const SEMANTIC_NAME_TO_FIELD: Record<string, string> = {
  // Income statement
  Turnover: "revenue",
  NetTurnover: "revenue",
  OperatingProfitLoss: "operating_profit",
  GainLossPeriod: "net_profit",
  GainLossForThePeriod: "net_profit",
  ProfitLossPeriod: "net_profit",
  ProfitLossForThePeriod: "net_profit",
  // Balance sheet — assets
  Assets: "total_assets",
  TotalAssets: "total_assets",
  FixedAssets: "fixed_assets",
  CurrentsAssets: "current_assets", // actual NBB taxonomy spelling
  CurrentAssets: "current_assets",
  Stocks: "inventory",
  Inventories: "inventory",
  InventoriesContractsInProgress: "inventory",
  CashBankHand: "cash_and_equivalents",
  CashAtBankAndInHand: "cash_and_equivalents",
  CashAndCashEquivalents: "cash_and_equivalents",
  // Balance sheet — equity & liabilities
  Equity: "total_equity",
  TotalEquity: "total_equity",
  Liabilities: "total_liabilities",
  TotalLiabilities: "total_liabilities",
  AmountsPayableAfterOneYear: "long_term_debt",
  AmountsPayableWithinOneYear: "short_term_debt",
  // Social balance — employees (multiple aliases hold the same FTE
  // value in the same filing, any of them works)
  EmployeesRecordedPersonnelRegisterAverageNumberEmployeesCalculatedFullTimeEquivalents:
    "employees_fte",
  AverageNumberEmployeesPersonnelRegisterTotalFullTimeEquivalents:
    "employees_fte",
  AverageNumberEmployeesFullTimeEquivalents: "employees_fte",
};
