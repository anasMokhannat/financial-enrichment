import { Building2, MapPin } from "lucide-react";

import { formatHuman } from "@/lib/server/enterpriseNumber";
import { formatSiren } from "@/lib/server/siren";
import type { CompanyFinancialReport, Country } from "@/lib/types";

import { RefreshButton } from "./RefreshButton";

/**
 * Company-page header card.
 *
 * The shape differs by country because the upstream data does:
 *
 *   Belgium (KBO + NBB) — Bowls.be-inspired full grid: Statut, CBE,
 *     Assujettissement TVA, Création, Dernier bilan, Taille,
 *     Adresse, Activité principale. All sourced from KBO's detail
 *     page so they're routinely populated.
 *
 *   France (INPI) — only a subset is exposed by the bilans-saisis
 *     endpoint: SIREN, address, last filing year, NAF/APE activity
 *     code. Status, VAT, creation date and headcount aren't carried
 *     on that endpoint, so we drop those fields rather than render a
 *     wall of em-dashes.
 *
 * A tiny country chip on the right makes the source obvious at a
 * glance — useful when a sales rep has BE and FR tabs open.
 */
export function CompanyHeader({ report }: { report: CompanyFinancialReport }) {
  const { company, filings, statements } = report;
  const isBelgian = company.country === "BE";

  const idLabel = isBelgian ? "Numéro d'entreprise" : "SIREN";
  const idHuman = isBelgian
    ? `BE ${formatHuman(company.enterprise_number)}`
    : formatSiren(company.enterprise_number);

  const latestFiscalYear =
    statements[0]?.fiscal_year ?? filings[0]?.fiscal_year ?? null;
  const mainActivity =
    company.nace_codes.find((c) => c.description)?.description ?? null;
  // For FR we don't have NACE descriptions on the saisi endpoint —
  // surface the raw code as a fallback.
  const activityCode = company.nace_codes[0]?.code ?? null;

  return (
    <section className="rounded-card border border-surface-line bg-surface px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-xl font-semibold text-ink">
              {company.name ?? `${idLabel} ${company.enterprise_number}`}
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
              {idHuman}
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
          <div className="flex items-center gap-1.5">
            <CountryChip country={company.country} />
            <RefreshButton cbe={company.enterprise_number} />
          </div>
          {company.dissolution_date && (
            <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">
              Dissolved · {company.dissolution_date}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-surface-line pt-4">
        {isBelgian ? (
          <BelgianGrid
            company={company}
            cbeHuman={idHuman}
            latestFiscalYear={latestFiscalYear}
            mainActivity={mainActivity}
          />
        ) : (
          <FrenchGrid
            company={company}
            sirenHuman={idHuman}
            latestFiscalYear={latestFiscalYear}
            mainActivity={mainActivity}
            activityCode={activityCode}
          />
        )}
      </div>
    </section>
  );
}

// ── country-specific grids ─────────────────────────────────────────────

function BelgianGrid({
  company,
  cbeHuman,
  latestFiscalYear,
  mainActivity,
}: {
  company: CompanyFinancialReport["company"];
  cbeHuman: string;
  latestFiscalYear: number | null;
  mainActivity: string | null;
}) {
  const statusLabel = company.status?.trim() ?? null;
  const isActive = statusLabel
    ? /actif|active|actief/i.test(statusLabel)
    : null;
  return (
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
        <span className="font-mono">{cbeHuman}</span>
      </Field>

      <Field label="Assujettissement TVA">
        {vatSubjectLabel(company.vat_subject)}
      </Field>

      <Field label="Création">{company.start_date ?? "—"}</Field>

      <Field label="Dernier bilan">
        {latestFiscalYear !== null ? String(latestFiscalYear) : "—"}
      </Field>

      <Field label="Taille d'entreprise">—</Field>

      <Field label="Adresse" className="md:col-span-3">
        {company.address ?? "—"}
      </Field>

      <Field label="Activité principale" className="md:col-span-3">
        {mainActivity ?? "—"}
      </Field>
    </dl>
  );
}

function FrenchGrid({
  company,
  sirenHuman,
  latestFiscalYear,
  mainActivity,
  activityCode,
}: {
  company: CompanyFinancialReport["company"];
  sirenHuman: string;
  latestFiscalYear: number | null;
  mainActivity: string | null;
  activityCode: string | null;
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
      <Field label="SIREN">
        <span className="font-mono">{sirenHuman}</span>
      </Field>

      <Field label="Dernier bilan">
        {latestFiscalYear !== null ? String(latestFiscalYear) : "—"}
      </Field>

      <Field label="Code NAF">
        {activityCode ? (
          <span className="font-mono">{activityCode}</span>
        ) : (
          "—"
        )}
      </Field>

      <Field label="Adresse" className="md:col-span-3">
        {company.address ?? "—"}
      </Field>

      {mainActivity && (
        <Field label="Activité principale" className="md:col-span-3">
          {mainActivity}
        </Field>
      )}
    </dl>
  );
}

// ── small parts ────────────────────────────────────────────────────────

const COUNTRY_META: Record<
  Country,
  { flag: string; label: string; provider: string }
> = {
  BE: { flag: "🇧🇪", label: "Belgium", provider: "KBO · NBB" },
  FR: { flag: "🇫🇷", label: "France", provider: "INPI" },
};

function CountryChip({ country }: { country: Country }) {
  const meta = COUNTRY_META[country];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-surface-line bg-surface-sub/40 px-2 py-1 text-[10px] font-medium text-ink-subtle"
      title={`Data source: ${meta.provider}`}
    >
      <span aria-hidden className="text-xs leading-none">
        {meta.flag}
      </span>
      <span>{meta.label}</span>
      <span className="text-ink-muted">· {meta.provider}</span>
    </span>
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
