import { notFound } from "next/navigation";

import { CommercialAnalysisPanel } from "@/components/CommercialAnalysisPanel";
import { CompanyReport } from "@/components/CompanyReport";
import { GroupStructure } from "@/components/GroupStructure";
import { NoFilingsCard } from "@/components/NoFilingsCard";
import { Prospects } from "@/components/Prospects";
import { RefreshButton } from "@/components/RefreshButton";
import { EnrichmentRepository } from "@/lib/server/db/repository";
import { tryNormalise } from "@/lib/server/enterpriseNumber";
import { EnrichmentPipeline } from "@/lib/server/pipeline";
import { KBOScraperError, NoFilingsError } from "@/lib/server/errors";
import type { CompanyFinancialReport } from "@/lib/types";

/**
 * Company detail page. Server component: it fetches the report on the
 * initial request so the page is shareable. Everything stateful (FY
 * selector, tab switching, charts) lives in the CompanyReport client
 * component mounted below the header.
 *
 * NB: this calls the repository / pipeline directly rather than going
 * through `/api/companies/[cbe]`. Same-runtime function call is faster
 * than a self-HTTP round-trip and dodges Vercel Deployment Protection,
 * which would 401 on SSR fetches to our own deployment URL.
 */
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ cbe: string }>;
}) {
  const { cbe } = await params;
  const cbeNorm = tryNormalise(cbe);
  if (cbeNorm === null) notFound();

  let report: CompanyFinancialReport | null = null;
  const repo = EnrichmentRepository.create();

  if (repo !== null) {
    try {
      report = await repo.getReport(cbeNorm);
    } catch (err) {
      console.warn(`Cache read failed for ${cbeNorm}:`, err);
    }
  }

  if (report === null || report.statements.length === 0) {
    let pipelineReport;
    try {
      const pipeline = new EnrichmentPipeline();
      pipelineReport = await pipeline.run(cbeNorm);
    } catch (err) {
      if (err instanceof KBOScraperError) notFound();
      if (err instanceof NoFilingsError) {
        return (
          <NoFilingsCard
            cbe={err.company.enterprise_number}
            name={err.company.name}
          />
        );
      }
      throw err;
    }
    report = pipelineReport;
    if (repo !== null) {
      try {
        await repo.saveReport(pipelineReport, "pdf-llm-v1");
      } catch (err) {
        console.warn(`Failed to persist report for ${cbeNorm}:`, err);
      }
    }
  }

  // report is non-null here: either the cache path populated it, or
  // the pipeline path threw on failure and never reached this line.
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

      <Prospects company={company} />

      <GroupStructure cbe={company.enterprise_number} />

      <CommercialAnalysisPanel cbe={company.enterprise_number} />

      <CompanyReport report={report} />
    </div>
  );
}
