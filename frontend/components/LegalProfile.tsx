import type { Company } from "@/lib/types";

/**
 * Two-section legal profile: NACE activity classifications (table) +
 * Functions / directors (table). Mirrors the Legal Profile tab from
 * the old Streamlit dashboard.
 */
export function LegalProfile({ company }: { company: Company }) {
  const hasNace = company.nace_codes.length > 0;
  const hasFunctions = company.functions.length > 0;

  if (!hasNace && !hasFunctions) {
    return (
      <div className="rounded-card bg-surface px-6 py-8 text-center shadow-card ring-1 ring-surface-line">
        <p className="text-sm font-medium text-ink">
          No legal profile data was returned by KBO for this company.
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Possible causes: the KBO detail page is temporarily
          unreachable, the company has no published NACE activities,
          or the parser did not recognise this page layout.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <header className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink">
            Activities (NACE)
          </h3>
          {hasNace && (
            <span className="text-xs text-ink-muted">
              {company.nace_codes.length} entries across{" "}
              {
                new Set(
                  company.nace_codes.map(
                    (n) => `${n.source ?? "?"}_${n.version ?? "?"}`
                  )
                ).size
              }{" "}
              classifications
            </span>
          )}
        </header>
        {hasNace ? (
          <DataTable
            head={["Code", "Description", "Source", "Version", "Since"]}
            rows={company.nace_codes.map((n) => [
              <span key="c" className="font-mono">{n.code}</span>,
              n.description ?? "—",
              n.source ?? "—",
              n.version?.toString() ?? "—",
              n.since ?? "—",
            ])}
          />
        ) : (
          <Empty body="No NACE activities listed on KBO." />
        )}
      </section>

      <section>
        <header className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink">Functions</h3>
          {hasFunctions && (
            <span className="text-xs text-ink-muted">
              {company.functions.length} roles
            </span>
          )}
        </header>
        {hasFunctions ? (
          <DataTable
            head={["Role", "Holder", "Holder CBE", "Since"]}
            rows={company.functions.map((f) => [
              f.role,
              f.holder_name ??
                (f.holder_enterprise_number
                  ? `CBE ${f.holder_enterprise_number}`
                  : "—"),
              f.holder_enterprise_number ? (
                <span key="cbe" className="font-mono text-xs">
                  {f.holder_enterprise_number}
                </span>
              ) : (
                "—"
              ),
              f.since ?? "—",
            ])}
          />
        ) : (
          <Empty body="No functions listed on KBO (often hidden behind CAPTCHA on public search)." />
        )}
      </section>
    </div>
  );
}

function DataTable({
  head,
  rows,
}: {
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-hidden rounded-card border border-surface-line bg-surface shadow-card">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-sub text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-line">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-surface-sub/60">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-ink-subtle">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ body }: { body: string }) {
  return (
    <p className="rounded-lg bg-surface-sub px-4 py-3 text-xs text-ink-muted">
      {body}
    </p>
  );
}
