"use client";

import {
  AlertCircle,
  Briefcase,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  Search,
  Users,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { cleanHolderName } from "@/lib/holderName";
import type { Company } from "@/lib/types";

/**
 * Apollo-enrichment response shape (subset). Matches EnrichResult from
 * lib/server/apollo/client.ts.
 */
type EnrichResult = {
  matched: boolean;
  email: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  photo_url: string | null;
  organization_name: string | null;
};

type EnrichState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: EnrichResult }
  | { kind: "error"; message: string };

/**
 * Lists the company's directors / officers as outreach prospects.
 *
 * The KBO scraper already drops corporate-director rows (those with a
 * holder_enterprise_number) at extraction time, so every entry in
 * `company.functions` is a natural person here.
 */
export function Prospects({ company }: { company: Company }) {
  const prospects = company.functions;

  return (
    <section className="rounded-card border border-surface-line bg-surface px-5 py-4">
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-2 text-ink">
          <Users className="h-4 w-4 text-ink-muted" />
          <h2 className="text-sm font-semibold">Prospects</h2>
        </div>
        <span className="text-xs text-ink-muted">
          {prospects.length} director{prospects.length === 1 ? "" : "s"}
        </span>
      </header>

      {prospects.length === 0 ? (
        <p className="rounded-lg bg-surface-sub px-4 py-3 text-sm text-ink-muted">
          No named directors returned by KBO for this company (the public
          search page sometimes hides them behind a CAPTCHA).
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {prospects.map((p, i) => (
            <ProspectCard
              key={`${p.role}-${p.holder_name}-${i}`}
              role={p.role}
              name={cleanHolderName(p.holder_name)}
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
  const [enrich, setEnrich] = useState<EnrichState>({ kind: "idle" });

  async function findEmail() {
    setEnrich({ kind: "loading" });
    try {
      const resp = await fetch("/api/prospects/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ name, company_name: companyName }),
      });
      const text = await resp.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        // non-JSON; keep raw text
      }
      if (!resp.ok) {
        const detail =
          body && typeof body === "object" && "detail" in (body as Record<string, unknown>)
            ? String((body as { detail: unknown }).detail)
            : `Apollo request failed (HTTP ${resp.status})`;
        setEnrich({ kind: "error", message: detail });
        return;
      }
      setEnrich({ kind: "ok", data: body as EnrichResult });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setEnrich({ kind: "error", message });
    }
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-surface-line bg-surface-sub/40 px-3 py-2 transition hover:border-brand-200 hover:bg-surface">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-100 text-brand-700">
          <Briefcase className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-ink">{name}</div>
          <div className="truncate text-[11px] text-ink-subtle">{role}</div>
          {since && (
            <div className="text-[10px] text-ink-muted">since {since}</div>
          )}
        </div>
        <CopyButton text={name} />
      </div>

      {enrich.kind === "idle" && (
        <button
          type="button"
          onClick={findEmail}
          className="inline-flex w-full items-center justify-center gap-1 rounded-full bg-brand-500 px-2.5 py-1 text-[10px] font-semibold text-white shadow-card transition hover:bg-brand-600"
        >
          <Search className="h-2.5 w-2.5" />
          Find email (Apollo)
        </button>
      )}

      {enrich.kind === "loading" && (
        <div className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold text-brand-700">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Searching Apollo…
        </div>
      )}

      {enrich.kind === "ok" && <EnrichResultView data={enrich.data} retry={findEmail} />}

      {enrich.kind === "error" && (
        <div className="mt-1 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-800 ring-1 ring-rose-200">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">Apollo lookup failed</div>
            <div className="mt-0.5 leading-snug">{enrich.message}</div>
          </div>
          <button
            type="button"
            onClick={findEmail}
            className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-800 transition hover:bg-rose-200"
          >
            Retry
          </button>
        </div>
      )}
    </li>
  );
}

function EnrichResultView({
  data,
  retry,
}: {
  data: EnrichResult;
  retry: () => void;
}) {
  if (!data.matched) {
    return (
      <div className="mt-1 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        <div className="flex-1">
          <div className="font-semibold">No Apollo match</div>
          <div className="mt-0.5 leading-snug">
            Apollo couldn&apos;t find this person at the given company.
          </div>
        </div>
        <button
          type="button"
          onClick={retry}
          className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 transition hover:bg-amber-200"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-1.5 rounded-lg bg-emerald-50/60 px-3 py-2 ring-1 ring-emerald-200">
      <div className="flex items-baseline justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
        <span>Apollo match</span>
        {data.organization_name && (
          <span className="truncate font-normal normal-case text-emerald-800/80">
            @ {data.organization_name}
          </span>
        )}
      </div>

      {data.title && (
        <div className="text-[11px] text-ink-subtle">{data.title}</div>
      )}

      {data.email ? (
        <div className="flex items-center gap-2 rounded-md bg-surface px-2.5 py-1.5 ring-1 ring-surface-line">
          <Mail className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <a
            href={`mailto:${data.email}`}
            className="min-w-0 flex-1 truncate text-xs font-semibold text-ink hover:text-brand-700"
            title={data.email}
          >
            {data.email}
          </a>
          <CopyButton text={data.email} compact />
        </div>
      ) : (
        <div className="text-[11px] italic text-ink-muted">
          No email on file at Apollo.
        </div>
      )}

      {data.linkedin_url && (
        <a
          href={data.linkedin_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline"
        >
          LinkedIn
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </div>
  );
}

function CopyButton({ text, compact = false }: { text: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be blocked in some browser contexts.
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={copy}
        className={cn(
          "shrink-0 rounded-md p-1 ring-1 transition",
          copied
            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
            : "bg-surface-sub text-ink-muted ring-surface-line hover:text-ink",
        )}
        title={copied ? "Copied" : "Copy email"}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition",
        copied
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-surface text-ink-subtle ring-surface-line hover:text-ink",
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
