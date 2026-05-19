"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fmtEUR } from "@/lib/ratios";
import type { FinancialStatement } from "@/lib/types";

/**
 * Stacked-bar balance-sheet composition. For each fiscal year we draw
 * two bars side-by-side: Assets (fixed + current) and Equity+Liab
 * (equity + LT debt + ST debt). Under a consistent statement they
 * reach the same height.
 *
 * Implementation note: recharts doesn't have native paired-stacks, so
 * we flatten each year into two rows on the X axis with a "side"
 * suffix on the label.
 */
export function BalanceSheetChart({
  statements,
}: {
  statements: FinancialStatement[];
}) {
  const sorted = [...statements].sort(
    (a, b) => (a.fiscal_year ?? 0) - (b.fiscal_year ?? 0)
  );

  const data = sorted.flatMap((s) => {
    const label = s.fiscal_year ? `FY ${s.fiscal_year}` : s.reference;
    return [
      {
        label: `${label}\nAssets`,
        fixed_assets: s.fixed_assets ? Number(s.fixed_assets) : null,
        current_assets: s.current_assets ? Number(s.current_assets) : null,
      },
      {
        label: `${label}\nE+L`,
        equity: s.total_equity ? Number(s.total_equity) : null,
        lt_debt: s.long_term_debt ? Number(s.long_term_debt) : null,
        st_debt: s.short_term_debt ? Number(s.short_term_debt) : null,
      },
    ];
  });

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
        <XAxis
          dataKey="label"
          tick={tickStyle}
          interval={0}
          tickFormatter={(s) => s as string}
        />
        <YAxis tickFormatter={(v) => fmtEUR(v)} tick={tickStyle} width={70} />
        <Tooltip content={<StackTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          iconType="circle"
          iconSize={8}
        />
        <Bar dataKey="fixed_assets" name="Fixed assets" stackId="assets" fill="#0EA5E9" />
        <Bar dataKey="current_assets" name="Current assets" stackId="assets" fill="#38BDF8" />
        <Bar dataKey="equity" name="Equity" stackId="liab" fill="#22C55E" />
        <Bar dataKey="lt_debt" name="LT debt" stackId="liab" fill="#F97316" />
        <Bar dataKey="st_debt" name="ST debt" stackId="liab" fill="#EF4444" />
      </BarChart>
    </ResponsiveContainer>
  );
}

const tickStyle = { fill: "#475569", fontSize: 11 };

function StackTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number | null; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce(
    (acc, row) => (row.value ? acc + row.value : acc),
    0
  );
  return (
    <div className="rounded-lg bg-surface px-3 py-2 text-xs shadow-card ring-1 ring-surface-line">
      <div className="font-medium text-ink">{(label ?? "").replace("\n", " · ")}</div>
      {payload.map((row) =>
        row.value ? (
          <div key={row.name} className="mt-1 flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ background: row.color }}
              aria-hidden
            />
            <span className="text-ink-subtle">{row.name}</span>
            <span className="ml-auto font-medium text-ink">
              {fmtEUR(row.value)}
            </span>
          </div>
        ) : null
      )}
      <div className="mt-1 flex items-center gap-2 border-t border-surface-line pt-1">
        <span className="text-ink-subtle">Total</span>
        <span className="ml-auto font-semibold text-ink">{fmtEUR(total)}</span>
      </div>
    </div>
  );
}
