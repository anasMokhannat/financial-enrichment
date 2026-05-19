import Link from "next/link";

import type { CompanyFinancialReport } from "@/lib/types";

/**
 * Compact "we found one!" card shown on the search page after a single
 * resolved match. Links through to the full detail page.
 */
export function CompanyReportCard({
  report,
  fromCache,
}: {
  report: CompanyFinancialReport;
  fromCache: boolean;
}) {
  const { company, filings, statements } = report;
  const latest = statements[0];

  return (
    <div className="rounded-card bg-surface px-6 py-5 shadow-card ring-1 ring-surface-line">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold text-ink">
            {company.name ?? `CBE ${company.enterprise_number}`}
          </div>
          <div className="font-mono text-xs text-ink-muted">
            {company.enterprise_number}
            {company.legal_form && (
              <span className="ml-2 text-ink-subtle">{company.legal_form}</span>
            )}
          </div>
        </div>
        <span
          className={
            fromCache
              ? "rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700"
              : "rounded-full bg-brand-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-700"
          }
        >
          {fromCache ? "From cache" : "Fresh"}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Status" value={company.status ?? "—"} />
        <Stat label="Filings" value={String(filings.length)} />
        <Stat label="Statements" value={String(statements.length)} />
        <Stat
          label="Latest FY"
          value={latest?.fiscal_year ? String(latest.fiscal_year) : "—"}
        />
      </dl>

      <div className="mt-5 flex justify-end">
        <Link
          href={`/companies/${company.enterprise_number}`}
          className="text-sm font-semibold text-brand-700 hover:text-brand-800"
        >
          Open full report →
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}
