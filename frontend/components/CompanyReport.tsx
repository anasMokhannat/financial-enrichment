"use client";

import {
  Banknote,
  Coins,
  FileSearch,
  Landmark,
  Receipt,
  TrendingUp,
  Users,
} from "lucide-react";
import { useState } from "react";

import { BalanceSheetChart } from "@/components/charts/BalanceSheetChart";
import { ProfitabilityChart } from "@/components/charts/ProfitabilityChart";
import { LegalProfile } from "@/components/LegalProfile";
import { RatiosRow } from "@/components/RatiosRow";
import { Tabs } from "@/components/Tabs";
import { cn } from "@/lib/cn";
import { fmtEUR } from "@/lib/ratios";
import type { CompanyFinancialReport, FinancialStatement } from "@/lib/types";

type MetricAccent = "cyan" | "emerald" | "indigo" | "violet" | "blue" | "rose";

const METRIC_ACCENT: Record<
  MetricAccent,
  { bg: string; fg: string }
> = {
  cyan: { bg: "bg-brand-50", fg: "text-brand-700" },
  emerald: { bg: "bg-accent-profit-50", fg: "text-accent-profit-700" },
  indigo: { bg: "bg-indigo-50", fg: "text-indigo-700" },
  violet: { bg: "bg-accent-equity-50", fg: "text-accent-equity-700" },
  blue: { bg: "bg-accent-cash-50", fg: "text-accent-cash-700" },
  rose: { bg: "bg-accent-people-50", fg: "text-accent-people-700" },
};

type Props = {
  report: CompanyFinancialReport;
};

/**
 * Client half of the company detail page. The server page renders the
 * static header + KPI tiles; this component handles the FY selector,
 * the ratios row, the tabbed charts and the legal-profile section.
 */
export function CompanyReport({ report }: Props) {
  const { company, statements } = report;

  // Sort ascending by fiscal year so "previous" is the entry before
  // the currently selected one.
  const sorted: FinancialStatement[] = [...statements].sort(
    (a, b) => (a.fiscal_year ?? 0) - (b.fiscal_year ?? 0)
  );

  const [selectedIdx, setSelectedIdx] = useState<number>(
    Math.max(0, sorted.length - 1)
  );
  const current = sorted[selectedIdx];
  const previous = selectedIdx > 0 ? sorted[selectedIdx - 1] : null;

  if (!current) {
    return (
      <>
        <EmptyStatementsCard hasFilings={report.filings.length > 0} />
        <section className="rounded-card bg-surface px-6 py-5 shadow-card ring-1 ring-surface-line">
          <h2 className="mb-4 text-lg font-semibold text-ink">Legal profile</h2>
          <LegalProfile company={company} />
        </section>
      </>
    );
  }

  return (
    <>
      <section className="rounded-card bg-surface px-6 py-5 shadow-card ring-1 ring-surface-line">
        <header className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink">
            Key metrics
          </h2>
          <label className="flex items-center gap-2 text-sm text-ink-subtle">
            <span>Fiscal year</span>
            <select
              value={selectedIdx}
              onChange={(e) => setSelectedIdx(Number(e.target.value))}
              className="rounded-lg border border-surface-line bg-surface px-3 py-1.5 text-sm font-medium text-ink outline-none transition focus:border-brand-300"
            >
              {sorted.map((s, i) => (
                <option key={s.reference} value={i}>
                  {s.fiscal_year ? `FY ${s.fiscal_year}` : s.reference}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Metric
            accent="cyan"
            icon={TrendingUp}
            label="Revenue"
            value={fmtEUR(current.revenue)}
          />
          <Metric
            accent="emerald"
            icon={Banknote}
            label="Net profit"
            value={fmtEUR(current.net_profit)}
          />
          <Metric
            accent="indigo"
            icon={Landmark}
            label="Total assets"
            value={fmtEUR(current.total_assets)}
          />
          <Metric
            accent="violet"
            icon={Coins}
            label="Equity"
            value={fmtEUR(current.total_equity)}
          />
          <Metric
            accent="blue"
            icon={Receipt}
            label="Cash"
            value={fmtEUR(current.cash_and_equivalents)}
          />
          <Metric
            accent="rose"
            icon={Users}
            label="Employees"
            value={
              current.employees_fte
                ? Number(current.employees_fte).toLocaleString()
                : "—"
            }
          />
        </div>
      </section>

      <section className="rounded-card bg-surface px-6 py-5 shadow-card ring-1 ring-surface-line">
        <h2 className="mb-4 text-lg font-semibold text-ink">
          Financial ratios
        </h2>
        <RatiosRow current={current} previous={previous} />
      </section>

      <section className="rounded-card bg-surface px-6 py-5 shadow-card ring-1 ring-surface-line">
        <Tabs
          tabs={[
            { id: "profit", label: "Profitability" },
            { id: "balance", label: "Balance sheet" },
            { id: "legal", label: "Legal profile" },
          ]}
        >
          {(active) => {
            if (active === "profit") {
              return <ProfitabilityChart statements={sorted} />;
            }
            if (active === "balance") {
              return <BalanceSheetChart statements={sorted} />;
            }
            return <LegalProfile company={company} />;
          }}
        </Tabs>
      </section>
    </>
  );
}

function EmptyStatementsCard({ hasFilings }: { hasFilings: boolean }) {
  return (
    <section className="rounded-card bg-surface px-6 py-10 text-center shadow-card ring-1 ring-surface-line">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600">
        <FileSearch className="h-5 w-5" />
      </div>
      <h2 className="text-base font-semibold text-ink">
        No financial statements yet
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-subtle">
        {hasFilings
          ? "We have filing references for this company but couldn't extract structured values from them. The legal profile below is still complete."
          : "This company is registered in KBO but hasn't deposited any annual accounts with the NBB. The legal profile below is still complete."}
      </p>
      <p className="mx-auto mt-3 max-w-md text-xs text-ink-muted">
        Use the <strong>Refresh</strong> button above to re-run the pipeline
        when new filings become available.
      </p>
    </section>
  );
}

function Metric({
  accent,
  icon: Icon,
  label,
  value,
}: {
  accent: MetricAccent;
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  const palette = METRIC_ACCENT[accent];
  return (
    <div className="rounded-xl border border-surface-line bg-surface px-3 py-3 transition hover:border-brand-200 hover:shadow-card">
      <div className="flex items-center gap-2">
        <span
          className={cn("grid h-6 w-6 place-items-center rounded-lg", palette.bg)}
        >
          <Icon className={cn("h-3.5 w-3.5", palette.fg)} />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
          {label}
        </span>
      </div>
      <div className="mt-2 text-xl font-bold text-ink">{value}</div>
    </div>
  );
}
