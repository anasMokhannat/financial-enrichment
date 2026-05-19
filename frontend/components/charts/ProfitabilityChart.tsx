"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fmtEUR } from "@/lib/ratios";
import type { FinancialStatement } from "@/lib/types";

/**
 * Profitability bars. Revenue is shown on its own panel above the
 * Operating / Net Profit pair so the profits don't render as invisible
 * slivers next to a revenue bar two orders of magnitude taller.
 */
export function ProfitabilityChart({
  statements,
}: {
  statements: FinancialStatement[];
}) {
  const data = [...statements]
    .sort((a, b) => (a.fiscal_year ?? 0) - (b.fiscal_year ?? 0))
    .map((s) => ({
      label: s.fiscal_year ? `FY ${s.fiscal_year}` : s.reference,
      revenue: s.revenue ? Number(s.revenue) : null,
      operating: s.operating_profit ? Number(s.operating_profit) : null,
      net: s.net_profit ? Number(s.net_profit) : null,
    }));

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Revenue">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="label" tick={tickStyle} />
            <YAxis tickFormatter={(v) => fmtEUR(v)} tick={tickStyle} width={70} />
            <Tooltip content={<MoneyTooltip />} />
            <Bar dataKey="revenue" fill="#3CC0E9" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Operating & Net Profit">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="label" tick={tickStyle} />
            <YAxis tickFormatter={(v) => fmtEUR(v)} tick={tickStyle} width={70} />
            <Tooltip content={<MoneyTooltip />} />
            <Bar dataKey="operating" name="Operating profit" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
            <Bar dataKey="net" name="Net profit" fill="#A855F7" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}

const tickStyle = { fill: "#475569", fontSize: 11 };

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

function MoneyTooltip({
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
            {fmtEUR(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
