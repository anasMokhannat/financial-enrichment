"use client";

import { cn } from "@/lib/cn";
import { computeRatios, fmtDelta, fmtPct, fmtRatio } from "@/lib/ratios";
import type { FinancialStatement } from "@/lib/types";

/**
 * Compact 3-tile signal row for sales readers.
 *
 * The hero ([CommercialAnalysisPanel](./CommercialAnalysisPanel.tsx))
 * already shows the liquidity ratios — this row complements with the
 * three commercial-direction signals a salesperson actually looks for:
 *
 *   Revenue growth  – "are they expanding?" (momentum / deal-size up-rotate)
 *   Net margin      – "are they making money?" (ability to spend on tools)
 *   Debt / Equity   – "are they over-leveraged?" (risk / runway sustainability)
 *
 * No help icons, no formulas, no group titles — those were leftovers
 * from a credit-analyst-oriented design. Sales sees label + value + YoY delta.
 */

type TileSpec = {
  label: string;
  key: keyof ReturnType<typeof computeRatios>;
  kind: "pct" | "ratio";
  higherIsBetter: boolean;
};

const TILES: TileSpec[] = [
  {
    label: "Revenue growth",
    key: "revenue_growth",
    kind: "pct",
    higherIsBetter: true,
  },
  {
    label: "Net margin",
    key: "net_margin",
    kind: "pct",
    higherIsBetter: true,
  },
  {
    label: "Debt / Equity",
    key: "debt_to_equity",
    kind: "ratio",
    higherIsBetter: false,
  },
];

type Props = {
  current: FinancialStatement;
  previous: FinancialStatement | null;
};

export function RatiosRow({ current, previous }: Props) {
  const now = computeRatios(current, previous);
  const before = previous ? computeRatios(previous, null) : null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {TILES.map((tile) => (
        <Cell
          key={tile.key}
          tile={tile}
          curr={now[tile.key]}
          prev={before ? before[tile.key] : null}
        />
      ))}
    </div>
  );
}

function Cell({
  tile,
  curr,
  prev,
}: {
  tile: TileSpec;
  curr: number | null;
  prev: number | null;
}) {
  const value = tile.kind === "pct" ? fmtPct(curr) : fmtRatio(curr);
  const delta = fmtDelta(curr, prev, tile.kind);
  const deltaIsGood = tile.higherIsBetter
    ? delta?.positive
    : delta && !delta.positive;

  return (
    <div className="flex items-baseline justify-between gap-2 rounded-md border border-surface-line bg-surface px-2.5 py-1.5">
      <span className="text-[11px] text-ink-muted">{tile.label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-ink">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              "text-[10px] font-medium tabular-nums",
              deltaIsGood ? "text-emerald-600" : "text-rose-600",
            )}
          >
            {delta.label}
          </span>
        )}
      </span>
    </div>
  );
}
