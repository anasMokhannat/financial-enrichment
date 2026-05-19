import { Building2, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import Link from "next/link";

import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { CompanyListItem, CompanyListResponse } from "@/lib/types";

const PAGE_SIZE = 50;

/**
 * Companies index. Server-fetched, paginated by query string
 * (`?page=2`). Cache-only — never runs the pipeline. Empty cache
 * renders an inviting empty state pointing the user at search.
 */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  let resp: CompanyListResponse | null = null;
  let error: string | null = null;
  try {
    resp = await api.listCompanies({ limit: PAGE_SIZE, offset });
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      error =
        "Supabase isn't configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env and restart the API.";
    } else if (err instanceof Error) {
      error = err.message;
    } else {
      error = "Unknown error";
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
            <Building2 className="h-3.5 w-3.5" />
            Cache
          </div>
          <h1 className="text-2xl font-bold text-ink">Companies</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            Every company you&apos;ve looked up — stored in Supabase
            for instant re-open.
          </p>
        </div>
        {resp && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-100">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            {resp.total} total
          </span>
        )}
      </header>

      {error && (
        <div className="rounded-card bg-rose-50 px-5 py-4 text-sm text-rose-900 shadow-card ring-1 ring-rose-200">
          {error}
        </div>
      )}

      {resp && resp.items.length === 0 && (
        <div className="rounded-card bg-surface px-6 py-12 text-center shadow-card ring-1 ring-surface-line">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
            <Building2 className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold text-ink">
            No companies cached yet
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Go to{" "}
            <Link href="/search" className="font-medium text-brand-700 hover:text-brand-800">
              Search
            </Link>{" "}
            or{" "}
            <Link href="/bulk" className="font-medium text-brand-700 hover:text-brand-800">
              Bulk
            </Link>{" "}
            to add the first ones.
          </p>
        </div>
      )}

      {resp && resp.items.length > 0 && (
        <>
          <CompaniesTable items={resp.items} />
          <Pagination
            page={page}
            total={resp.total}
            pageSize={PAGE_SIZE}
          />
        </>
      )}
    </div>
  );
}

function CompaniesTable({ items }: { items: CompanyListItem[] }) {
  return (
    <div className="overflow-hidden rounded-card border border-surface-line bg-surface shadow-card">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-sub text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          <tr>
            <th className="px-4 py-3 text-left">Name</th>
            <th className="px-4 py-3 text-left">CBE</th>
            <th className="px-4 py-3 text-left">Legal form</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-right">Filings</th>
            <th className="px-4 py-3 text-right">Last refresh</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-line">
          {items.map((c) => (
            <tr
              key={c.enterprise_number}
              className="group transition hover:bg-brand-50/40"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/companies/${c.enterprise_number}`}
                  className="flex items-center gap-2.5 font-medium text-ink transition group-hover:text-brand-700"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 transition group-hover:bg-brand-100">
                    <Building2 className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate">
                    {c.name ?? <em className="text-ink-muted">unnamed</em>}
                  </span>
                </Link>
                {c.trade_name && c.trade_name !== c.name && (
                  <div className="ml-9 text-xs text-ink-muted">{c.trade_name}</div>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-ink-subtle">
                {c.enterprise_number}
              </td>
              <td className="px-4 py-3 text-ink-subtle">
                {c.legal_form ?? "—"}
              </td>
              <td className="px-4 py-3">
                <StatusPill status={c.status} dissolution={c.dissolution_date} />
              </td>
              <td className="px-4 py-3 text-right">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                    c.statement_count > 0
                      ? "bg-accent-profit-50 text-accent-profit-700"
                      : "bg-surface-sub text-ink-muted"
                  )}
                >
                  <FileText className="h-3 w-3" />
                  {c.statement_count}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-xs text-ink-muted">
                {formatRelative(c.last_refreshed_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({
  status,
  dissolution,
}: {
  status: string | null;
  dissolution: string | null;
}) {
  if (dissolution) {
    return (
      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700">
        Dissolved
      </span>
    );
  }
  if (!status) return <span className="text-ink-muted">—</span>;
  const isActive = status.toLowerCase().startsWith("active");
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        isActive
          ? "bg-emerald-50 text-emerald-700"
          : "bg-surface-sub text-ink-subtle"
      )}
    >
      {status}
    </span>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} d ago`;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Pagination({
  page,
  total,
  pageSize,
}: {
  page: number;
  total: number;
  pageSize: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const prevHref = page > 1 ? `/companies?page=${page - 1}` : null;
  const nextHref = page < totalPages ? `/companies?page=${page + 1}` : null;

  return (
    <nav className="flex items-center justify-between text-sm text-ink-subtle">
      <div>
        Page {page} of {totalPages}
      </div>
      <div className="flex gap-2">
        <PaginationLink href={prevHref} icon={<ChevronLeft className="h-4 w-4" />} label="Previous" />
        <PaginationLink href={nextHref} icon={<ChevronRight className="h-4 w-4" />} label="Next" rightIcon />
      </div>
    </nav>
  );
}

function PaginationLink({
  href,
  icon,
  label,
  rightIcon = false,
}: {
  href: string | null;
  icon: React.ReactNode;
  label: string;
  rightIcon?: boolean;
}) {
  const className = cn(
    "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
    href
      ? "border-surface-line bg-surface text-ink hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
      : "cursor-not-allowed border-surface-line bg-surface-sub text-ink-muted"
  );
  if (!href) {
    return (
      <span className={className} aria-disabled>
        {!rightIcon && icon}
        {label}
        {rightIcon && icon}
      </span>
    );
  }
  return (
    <Link href={href as never} className={className}>
      {!rightIcon && icon}
      {label}
      {rightIcon && icon}
    </Link>
  );
}
