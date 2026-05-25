import { Building2, MapPin } from "lucide-react";

import { formatHuman } from "@/lib/server/enterpriseNumber";
import type { CompanyFinancialReport } from "@/lib/types";

import { RefreshButton } from "./RefreshButton";

/**
 * Company-page header card. Inspired by the Companyweb / Bowls.be
 * layout: a top strip with the canonical name + legal form, CBE and
 * address, then an `Informations d'entreprise` grid summarising the
 * fields a reader most often needs.
 *
 * FTE size is intentionally left as "—" — KBO doesn't carry it on the
 * public detail page; it would have to come from the NBB social-balance
 * filing, which the current pipeline does not extract.
 */
export function CompanyHeader({ report }: { report: CompanyFinancialReport }) {
  const { company, filings, statements } = report;

  const cbeHuman = formatHuman(company.enterprise_number);
  const statusLabel = company.status?.trim() ?? null;
  const isActive = statusLabel
    ? /actif|active|actief/i.test(statusLabel)
    : null;

  const vatLabel = vatSubjectLabel(company.vat_subject);
  const latestFiscalYear =
    statements[0]?.fiscal_year ?? filings[0]?.fiscal_year ?? null;
  const mainActivity =
    company.nace_codes.find((c) => c.description)?.description ?? null;

  return (
    <section className="rounded-card border border-surface-line bg-surface px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-xl font-semibold text-ink">
              {company.name ?? `CBE ${company.enterprise_number}`}
            </h1>
            {company.legal_form && (
              <span className="text-sm text-ink-muted">
                {company.legal_form}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
            <span className="inline-flex items-center gap-1 font-mono text-ink-muted">
              <Building2 className="h-3 w-3" />
              BE {cbeHuman}
            </span>
            {company.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3 text-ink-muted" />
                {company.address}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <RefreshButton cbe={company.enterprise_number} />
          {company.dissolution_date && (
            <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">
              Dissolved · {company.dissolution_date}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-surface-line pt-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
          <Field label="Statut">
            {statusLabel ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`h-2 w-2 rounded-full ${
                    isActive === true
                      ? "bg-emerald-500"
                      : isActive === false
                      ? "bg-rose-500"
                      : "bg-ink-muted"
                  }`}
                />
                {statusLabel}
              </span>
            ) : (
              "—"
            )}
          </Field>

          <Field label="Numéro d'entreprise">
            <span className="font-mono">BE {cbeHuman}</span>
          </Field>

          <Field label="Assujettissement TVA">{vatLabel}</Field>

          <Field label="Création">{company.start_date ?? "—"}</Field>

          <Field label="Dernier bilan">
            {latestFiscalYear !== null ? String(latestFiscalYear) : "—"}
          </Field>

          <Field label="Taille d'entreprise">—</Field>

          <Field label="Adresse" className="md:col-span-3">
            {company.address ?? "—"}
          </Field>

          <Field
            label="Activité principale"
            className="md:col-span-3"
          >
            {mainActivity ?? "—"}
          </Field>
        </dl>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

function vatSubjectLabel(value: boolean | null): string {
  if (value === true) return "Oui";
  if (value === false) return "Non";
  return "—";
}
