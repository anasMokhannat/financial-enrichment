import { notFound } from "next/navigation";

import { CommercialAnalysisPanel } from "@/components/CommercialAnalysisPanel";
import { CompanyReport } from "@/components/CompanyReport";
import { RefreshButton } from "@/components/RefreshButton";
import { ApiError, api } from "@/lib/api";
import type { CompanyFinancialReport } from "@/lib/types";

/**
 * Company detail page. Server component: it fetches the report on the
 * initial request so the page is shareable. Everything stateful (FY
 * selector, tab switching, charts) lives in the CompanyReport client
 * component mounted below the header.
 */
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ cbe: string }>;
}) {
  const { cbe } = await params;

  let report: CompanyFinancialReport;
  try {
    report = await api.getCompany(cbe);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const { company } = report;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="rounded-card bg-surface px-6 py-6 shadow-card ring-1 ring-surface-line">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">
              {company.name ?? `CBE ${company.enterprise_number}`}
            </h1>
            <div className="mt-1 font-mono text-xs text-ink-muted">
              {company.enterprise_number}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-subtle">
              {company.legal_form && <span>{company.legal_form}</span>}
              {company.status && (
                <span className="text-ink">{company.status}</span>
              )}
              {company.address && <span>{company.address}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <RefreshButton cbe={company.enterprise_number} />
            {company.dissolution_date && (
              <span className="rounded-full bg-rose-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-rose-700 ring-1 ring-rose-200">
                Dissolved {company.dissolution_date}
              </span>
            )}
          </div>
        </div>
      </header>

      <CommercialAnalysisPanel cbe={company.enterprise_number} />

      <CompanyReport report={report} />
    </div>
  );
}
