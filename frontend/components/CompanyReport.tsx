"use client";

import { FileSearch } from "lucide-react";
import { useState } from "react";

import { LiquidityChart } from "@/components/charts/LiquidityChart";
import { LegalProfile } from "@/components/LegalProfile";
import { RatiosRow } from "@/components/RatiosRow";
import { Tabs } from "@/components/Tabs";
import { ViewPdfButton } from "@/components/ViewPdfButton";
import { fmtEUR } from "@/lib/ratios";
import type { CompanyFinancialReport, FinancialStatement } from "@/lib/types";

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
        <section className="rounded-card border border-surface-line bg-surface px-5 py-4">
          <h2 className="mb-4 text-lg font-semibold text-ink">Legal profile</h2>
          <LegalProfile company={company} />
        </section>
      </>
    );
  }

  return (
    <>
      <section className="rounded-card border border-surface-line bg-surface px-4 py-3">
        <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Key metrics</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-ink-subtle">
              <span>FY</span>
              <select
                value={selectedIdx}
                onChange={(e) => setSelectedIdx(Number(e.target.value))}
                className="h-7 rounded-md border border-surface-line bg-surface px-2 text-xs font-medium text-ink outline-none transition focus:border-brand-300"
              >
                {sorted.map((s, i) => (
                  <option key={s.reference} value={i}>
                    {s.fiscal_year ? `FY ${s.fiscal_year}` : s.reference}
                  </option>
                ))}
              </select>
            </label>
            <ViewPdfButton
              cbe={current.enterprise_number}
              reference={current.reference}
            />
          </div>
        </header>

        {/* Six tiles in one card — first row: deal-size + cash. Second
            row: trend signals (momentum / profitability / leverage).
            One bordered wrapper instead of two = far less wasted space. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric label="Revenue" value={fmtEUR(current.revenue)} />
          <Metric label="Net profit" value={fmtEUR(current.net_profit)} />
          <Metric label="Cash" value={fmtEUR(current.cash_and_equivalents)} />
        </div>
        <div className="mt-2">
          <RatiosRow current={current} previous={previous} />
        </div>
      </section>

      <section className="rounded-card border border-surface-line bg-surface px-5 py-4">
        <Tabs
          tabs={[
            { id: "liquidity", label: "Liquidity" },
            { id: "legal", label: "Legal profile" },
          ]}
        >
          {(active) => {
            if (active === "liquidity") {
              return <LiquidityChart statements={sorted} />;
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
    <section className="rounded-card border border-surface-line bg-surface px-5 py-8 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-amber-50 text-amber-600">
        <FileSearch className="h-4 w-4" />
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-md border border-surface-line bg-surface px-2.5 py-1.5">
      <span className="text-[11px] text-ink-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-ink">
        {value}
      </span>
    </div>
  );
}
