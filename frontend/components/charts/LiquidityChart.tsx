"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { computeRatios } from "@/lib/ratios";
import type { FinancialStatement } from "@/lib/types";

/**
 * Liquidity-over-time chart for the sales-prospecting use case.
 *
 * Three line series per fiscal year:
 *   - Current ratio   = current assets / short-term debt
 *   - Quick ratio     = (current assets - inventory) / short-term debt
 *   - Cash ratio      = cash + equivalents / short-term debt
 *
 * The dashed reference line at 1.0 is the rule-of-thumb threshold:
 * below 1.0 means the company can't cover its near-term obligations
 * from the corresponding pool of assets. The chart deliberately omits
 * leverage ratios (D/E) because those live on a different scale —
 * keeping the y-axis comparable makes the trend lines readable.
 *
 * For each year we compute the ratios against the *previous* year's
 * statement so growth metrics that need a prior period (revenue growth,
 * FCF) work out — but the liquidity ratios themselves only need the
 * current year's balance sheet.
 */
export function LiquidityChart({
  statements,
}: {
  statements: FinancialStatement[];
}) {
  const sorted = [...statements].sort(
    (a, b) => (a.fiscal_year ?? 0) - (b.fiscal_year ?? 0),
  );

  const data = sorted.map((s, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const r = computeRatios(s, prev);
    return {
      label: s.fiscal_year ? `FY ${s.fiscal_year}` : s.reference,
      current_ratio: r.current_ratio,
      quick_ratio: r.quick_ratio,
      cash_ratio: r.cash_ratio,
    };
  });

  if (data.every((d) => d.current_ratio === null && d.quick_ratio === null && d.cash_ratio === null)) {
    return (
      <p className="rounded-lg bg-surface-sub px-4 py-3 text-sm text-ink-muted">
        Not enough balance-sheet data to compute liquidity ratios for this
        company. Usually means short-term debt is missing from the filings.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-ink-muted">
        Liquidity ratios over time. Values below the dashed line at 1.0
        mean the company can&apos;t cover its short-term obligations from
        the matching pool of assets.
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
          <XAxis dataKey="label" tick={tickStyle} />
          <YAxis
            tick={tickStyle}
            width={50}
            tickFormatter={(v) => (typeof v === "number" ? v.toFixed(1) : v)}
          />
          <Tooltip content={<RatioTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
          <ReferenceLine
            y={1}
            stroke="#94A3B8"
            strokeDasharray="4 4"
            label={{
              value: "1.0",
              position: "right",
              fill: "#94A3B8",
              fontSize: 10,
            }}
          />
          <Line
            type="monotone"
            dataKey="current_ratio"
            name="Current ratio"
            stroke="#0EA5E9"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="quick_ratio"
            name="Quick ratio"
            stroke="#7C3AED"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="cash_ratio"
            name="Cash ratio"
            stroke="#059669"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>

      <dl className="grid grid-cols-1 gap-2 text-xs text-ink-subtle md:grid-cols-3">
        <Legend2
          color="#0EA5E9"
          label="Current ratio"
          formula="Current assets ÷ Short-term debt"
          read="Overall short-term cover."
        />
        <Legend2
          color="#7C3AED"
          label="Quick ratio"
          formula="(Current assets − Inventory) ÷ Short-term debt"
          read="Cover excluding slow-to-sell stock."
        />
        <Legend2
          color="#059669"
          label="Cash ratio"
          formula="Cash + equivalents ÷ Short-term debt"
          read="Strictest cover — pure cash on hand."
        />
      </dl>
    </div>
  );
}

const tickStyle = { fill: "#475569", fontSize: 11 };

function RatioTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number | null; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-surface px-3 py-2 text-xs shadow-card ring-1 ring-surface-line">
      <div className="font-medium text-ink">{label}</div>
      {payload.map((row) => (
        <div key={row.name} className="mt-1 flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-sm"
            style={{ background: row.color }}
            aria-hidden
          />
          <span className="text-ink-subtle">{row.name}</span>
          <span className="ml-auto font-medium text-ink">
            {row.value === null || row.value === undefined
              ? "—"
              : row.value.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Legend2({
  color,
  label,
  formula,
  read,
}: {
  color: string;
  label: string;
  formula: string;
  read: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-surface-line px-3 py-2">
      <div className="flex items-center gap-1.5 text-ink">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{ background: color }}
        />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <div className="text-[11px] text-ink-muted">{formula}</div>
      <div className="text-[11px] text-ink-subtle">{read}</div>
    </div>
  );
}
