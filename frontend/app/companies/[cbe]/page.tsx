import { notFound } from "next/navigation";

import { CommercialAnalysisPanel } from "@/components/CommercialAnalysisPanel";
import { CompanyHeader } from "@/components/CompanyHeader";
import { CompanyReport } from "@/components/CompanyReport";
import { GroupStructure } from "@/components/GroupStructure";
import { NoFilingsCard } from "@/components/NoFilingsCard";
import { Prospects } from "@/components/Prospects";
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

  // Trust the cache. If the company has been persisted at all, render
  // what we have — even when `statements` is empty (the pipeline can
  // legitimately produce 0 statements when PDF extraction fails or
  // filings are abbreviated). The user has the `Refresh` button to
  // force a fresh pipeline run; we shouldn't auto-rerun on every
  // visit, because each rerun costs an NBB call + N PDF + N OpenAI
  // round-trips and the result is usually identical.
  if (report === null) {
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
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <CompanyHeader report={report} />

      <Prospects company={company} />

      <GroupStructure cbe={company.enterprise_number} />

      <CommercialAnalysisPanel cbe={company.enterprise_number} />

      <CompanyReport report={report} />
    </div>
  );
}
