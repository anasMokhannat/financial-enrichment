"use client";

import { Briefcase, Copy, Mail, Users } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import type { Company } from "@/lib/types";

/**
 * Lists the company's directors / officers as outreach prospects.
 *
 * KBO's "Functions" section carries two flavours: real people
 * (`holder_name` set) and corporate directors (`holder_enterprise_number`
 * set, no name). Only the former are usable as B2B prospects, so we
 * filter on `holder_name` here.
 */
export function Prospects({ company }: { company: Company }) {
  const prospects = company.functions.filter(
    (f) => f.holder_name && f.holder_name.trim().length > 0,
  );

  return (
    <section className="rounded-card bg-surface px-6 py-5 shadow-card ring-1 ring-surface-line">
      <header className="mb-4 flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700">
            <Users className="h-4 w-4" />
          </span>
          <h2 className="text-lg font-semibold text-ink">Prospects</h2>
        </div>
        <span className="text-xs text-ink-muted">
          {prospects.length} director{prospects.length === 1 ? "" : "s"} from KBO
        </span>
      </header>

      {prospects.length === 0 ? (
        <p className="rounded-lg bg-surface-sub px-4 py-3 text-sm text-ink-muted">
          No named directors returned by KBO for this company (the public
          search page sometimes hides them behind a CAPTCHA).
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {prospects.map((p, i) => (
            <ProspectCard
              key={`${p.role}-${p.holder_name}-${i}`}
              role={p.role}
              name={p.holder_name as string}
              since={p.since}
              companyName={company.name}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProspectCard({
  role,
  name,
  since,
  companyName,
}: {
  role: string;
  name: string;
  since: string | null;
  companyName: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copyName() {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be blocked in some browser contexts;
      // silently no-op rather than crashing the panel.
    }
  }

  const linkedinUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
    `${name} ${companyName ?? ""}`.trim(),
  )}`;

  return (
    <li className="flex items-start gap-3 rounded-xl border border-surface-line bg-surface-sub/40 px-4 py-3 transition hover:border-brand-200 hover:bg-surface">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700">
        <Briefcase className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{name}</div>
        <div className="mt-0.5 truncate text-xs text-ink-subtle">{role}</div>
        {since && (
          <div className="mt-1 text-[11px] text-ink-muted">since {since}</div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <a
          href={linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-card transition hover:bg-brand-600"
          title="Search this person on LinkedIn"
        >
          <Mail className="h-3 w-3" />
          Find
        </a>
        <button
          type="button"
          onClick={copyName}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition",
            copied
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-surface text-ink-subtle ring-surface-line hover:text-ink",
          )}
        >
          <Copy className="h-3 w-3" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </li>
  );
}
