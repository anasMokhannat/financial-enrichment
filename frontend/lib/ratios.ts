/**
 * Financial-ratio helpers — TypeScript port of backend dashboard
 * `_compute_ratios`. Same formulas, same null-propagation semantics:
 * if any input is missing or the denominator is zero, the ratio is null.
 *
 * Cash-flow figures are approximations because Belgian filings don't
 * publish a mandatory cash-flow statement:
 *
 *   CFO   ≈ Net Profit + Depreciation
 *   CapEx ≈ ΔFixed Assets + Depreciation
 *   FCF   = CFO − CapEx
 *
 * Both CapEx and FCF need a previous-period statement.
 */

import type { FinancialStatement } from "./types";

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function div(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

export type Ratios = {
  revenue_growth: number | null;
  operating_margin: number | null;
  net_margin: number | null;
  roe: number | null;
  cfo_approx: number | null;
  fcf_approx: number | null;
  current_ratio: number | null;
  quick_ratio: number | null;
  cash_ratio: number | null;
  debt_to_equity: number | null;
  equity_ratio: number | null;
};

export function computeRatios(
  s: FinancialStatement,
  prev?: FinancialStatement | null
): Ratios {
  const rev = num(s.revenue);
  const op = num(s.operating_profit);
  const net = num(s.net_profit);
  const assets = num(s.total_assets);
  const equity = num(s.total_equity);
  const liab = num(s.total_liabilities);
  const curA = num(s.current_assets);
  const inv = num(s.inventory);
  const cash = num(s.cash_and_equivalents);
  const fa = num(s.fixed_assets);
  const lt = num(s.long_term_debt);
  const stD = num(s.short_term_debt);
  const dep = num(s.depreciation);

  // Debt: prefer long+short sum; fall back to total liabilities.
  const debt =
    lt !== null || stD !== null ? (lt ?? 0) + (stD ?? 0) : liab;

  // Quick ratio: missing inventory treated as zero (service companies).
  const quick_ratio =
    curA !== null && stD !== null && stD !== 0
      ? (curA - (inv ?? 0)) / stD
      : null;

  // CFO ≈ NP + Dep. Fall back to NP alone when depreciation is absent
  // (the abbreviated schema doesn't always disclose it).
  const cfo_approx =
    net !== null && dep !== null
      ? net + dep
      : net !== null
      ? net
      : null;

  // YoY revenue growth and CapEx-derived FCF need the prior statement.
  const prevRev = prev ? num(prev.revenue) : null;
  const prevFa = prev ? num(prev.fixed_assets) : null;

  const revenue_growth =
    rev !== null && prevRev !== null && prevRev !== 0
      ? (rev - prevRev) / Math.abs(prevRev)
      : null;

  let fcf_approx: number | null = null;
  if (fa !== null && prevFa !== null && cfo_approx !== null) {
    const capex = fa - prevFa + (dep ?? 0);
    fcf_approx = cfo_approx - capex;
  }

  return {
    revenue_growth,
    operating_margin: div(op, rev),
    net_margin: div(net, rev),
    roe: div(net, equity),
    cfo_approx,
    fcf_approx,
    current_ratio: div(curA, stD),
    quick_ratio,
    cash_ratio: div(cash, stD),
    debt_to_equity: div(debt, equity),
    equity_ratio: div(equity, assets),
  };
}

/* ────────────────────────────────────────────────────────────────── */
/*  Formatters                                                         */
/* ────────────────────────────────────────────────────────────────── */

export function fmtEUR(v: number | string | null | undefined): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `€${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `€${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `€${(n / 1e3).toFixed(1)}K`;
  return `€${n.toFixed(0)}`;
}

export function fmtPct(v: number | null, digits = 1): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtRatio(v: number | null, digits = 2): string {
  if (v === null) return "—";
  return v.toFixed(digits);
}

export function fmtDelta(
  curr: number | null,
  prev: number | null,
  kind: "pct" | "ratio" | "eur"
): { label: string; positive: boolean } | null {
  if (curr === null || prev === null || prev === 0) return null;
  const diff = curr - prev;
  if (diff === 0) return null;
  if (kind === "pct") {
    return {
      label: `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)} pp`,
      positive: diff > 0,
    };
  }
  if (kind === "ratio") {
    return {
      label: `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}`,
      positive: diff > 0,
    };
  }
  return {
    label: `${diff >= 0 ? "+" : ""}${fmtEUR(diff)}`,
    positive: diff > 0,
  };
}
