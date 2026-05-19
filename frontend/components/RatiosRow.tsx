"use client";

import { HelpCircle } from "lucide-react";

import { cn } from "@/lib/cn";
import { computeRatios, fmtDelta, fmtEUR, fmtPct, fmtRatio } from "@/lib/ratios";
import type { FinancialStatement } from "@/lib/types";

type Tile = {
  label: string;
  key: keyof ReturnType<typeof computeRatios>;
  kind: "pct" | "ratio" | "eur";
  higherIsBetter: boolean;
  /** Plain-language formula shown in the tile's hover tooltip. */
  formula: string;
  /** When true, an empty value is explained as "needs previous filing"
   *  if the current report doesn't have one. Otherwise it falls back
   *  to the generic em-dash placeholder. */
  requiresPrev?: boolean;
  approx?: boolean;
};

const PROFITABILITY_AND_GROWTH: Tile[] = [
  {
    label: "Revenue growth",
    key: "revenue_growth",
    kind: "pct",
    higherIsBetter: true,
    formula: "(Revenue − Prev. Revenue) / |Prev. Revenue|",
    requiresPrev: true,
  },
  {
    label: "Operating margin",
    key: "operating_margin",
    kind: "pct",
    higherIsBetter: true,
    formula: "Operating Profit / Revenue",
  },
  {
    label: "Net margin",
    key: "net_margin",
    kind: "pct",
    higherIsBetter: true,
    formula: "Net Profit / Revenue",
  },
  {
    label: "ROE",
    key: "roe",
    kind: "pct",
    higherIsBetter: true,
    formula: "Net Profit / Total Equity (return on equity)",
  },
  {
    label: "Op. cash flow",
    key: "cfo_approx",
    kind: "eur",
    higherIsBetter: true,
    approx: true,
    formula: "Approximation: Net Profit + Depreciation",
  },
  {
    label: "Free cash flow",
    key: "fcf_approx",
    kind: "eur",
    higherIsBetter: true,
    approx: true,
    requiresPrev: true,
    formula:
      "Approximation: CFO − CapEx, with CapEx ≈ ΔFixed Assets + Depreciation",
  },
];

const LIQUIDITY_AND_SOLVENCY: Tile[] = [
  {
    label: "Current ratio",
    key: "current_ratio",
    kind: "ratio",
    higherIsBetter: true,
    formula: "Current Assets / Short-term Debt (≥1 = liquid)",
  },
  {
    label: "Quick ratio",
    key: "quick_ratio",
    kind: "ratio",
    higherIsBetter: true,
    formula:
      "(Current Assets − Inventory) / Short-term Debt; missing inventory treated as zero",
  },
  {
    label: "Cash ratio",
    key: "cash_ratio",
    kind: "ratio",
    higherIsBetter: true,
    formula: "Cash & Equivalents / Short-term Debt (most conservative)",
  },
  {
    label: "Debt / Equity",
    key: "debt_to_equity",
    kind: "ratio",
    higherIsBetter: false,
    formula:
      "(Long-term Debt + Short-term Debt) / Total Equity; if both legs are missing, Total Liabilities / Equity",
  },
  {
    label: "Equity ratio",
    key: "equity_ratio",
    kind: "pct",
    higherIsBetter: true,
    formula: "Total Equity / Total Assets (solvency cushion)",
  },
];

type Props = {
  current: FinancialStatement;
  previous: FinancialStatement | null;
};

export function RatiosRow({ current, previous }: Props) {
  const now = computeRatios(current, previous);
  const before = previous ? computeRatios(previous, null) : null;
  const hasPrev = previous !== null;

  return (
    <div className="flex flex-col gap-6">
      <Group
        title="Profitability & Growth"
        caption="Cash-flow values are approximations: CFO ≈ Net Profit + Depreciation, FCF ≈ CFO − (ΔFixed Assets + Depreciation)."
        spec={PROFITABILITY_AND_GROWTH}
        now={now}
        before={before}
        hasPrev={hasPrev}
      />
      <Group
        title="Liquidity & Solvency"
        caption="Quick ratio treats missing inventory as zero — abbreviated-schema filings often skip the inventory line for service-only companies."
        spec={LIQUIDITY_AND_SOLVENCY}
        now={now}
        before={before}
        hasPrev={hasPrev}
      />
    </div>
  );
}

function Group({
  title,
  caption,
  spec,
  now,
  before,
  hasPrev,
}: {
  title: string;
  caption: string;
  spec: Tile[];
  now: ReturnType<typeof computeRatios>;
  before: ReturnType<typeof computeRatios> | null;
  hasPrev: boolean;
}) {
  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {spec.map((tile) => (
          <Cell
            key={tile.key}
            tile={tile}
            curr={now[tile.key]}
            prev={before ? before[tile.key] : null}
            hasPrev={hasPrev}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">{caption}</p>
    </section>
  );
}

function Cell({
  tile,
  curr,
  prev,
  hasPrev,
}: {
  tile: Tile;
  curr: number | null;
  prev: number | null;
  hasPrev: boolean;
}) {
  const needsPrev = curr === null && tile.requiresPrev === true && !hasPrev;

  // When the value is missing for a reason we can name, show that
  // reason inline on the card. Otherwise fall back to the formatted
  // em-dash from fmtPct / fmtEUR / fmtRatio.
  const value = needsPrev
    ? null
    : tile.kind === "pct"
    ? fmtPct(curr)
    : tile.kind === "eur"
    ? fmtEUR(curr)
    : fmtRatio(curr);

  const delta = fmtDelta(curr, prev, tile.kind);
  const deltaPositiveIsGood = tile.higherIsBetter
    ? delta?.positive
    : delta && !delta.positive;

  return (
    <div className="rounded-card bg-surface px-4 py-3 shadow-card ring-1 ring-surface-line">
      <div className="flex items-center gap-1 text-[11px] font-semibold text-ink-muted">
        <span>{tile.label}</span>
        {tile.approx && <span className="text-ink-muted/70">~</span>}
        <FormulaHint formula={tile.formula} />
      </div>

      {value !== null ? (
        <div className="mt-1 text-lg font-bold text-ink">{value}</div>
      ) : (
        <div
          className="mt-1 text-[11px] italic leading-snug text-ink-muted"
          title="Requires previous fiscal year — this is the first filing in the database."
        >
          Requires previous fiscal year — first filing in database.
        </div>
      )}

      {delta && value !== null && (
        <div
          className={cn(
            "mt-0.5 text-[11px] font-medium",
            deltaPositiveIsGood ? "text-emerald-600" : "text-rose-600"
          )}
        >
          {delta.label}
        </div>
      )}
    </div>
  );
}

/**
 * "?" icon next to the tile label; on hover shows the formula in a
 * small popover. CSS-only — no external tooltip library needed.
 */
function FormulaHint({ formula }: { formula: string }) {
  return (
    <span className="group relative inline-flex">
      <HelpCircle
        className="h-3 w-3 cursor-help text-ink-muted/70 transition hover:text-brand-600"
        aria-hidden
      />
      <span className="sr-only">{formula}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-normal rounded-lg bg-ink px-3 py-2 text-[11px] font-normal leading-snug text-white shadow-lg group-hover:block group-focus-within:block min-w-[180px] max-w-[260px] text-center"
      >
        {formula}
      </span>
    </span>
  );
}
