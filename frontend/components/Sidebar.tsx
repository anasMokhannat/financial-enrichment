"use client";

import { Building2, Calculator, LayoutDashboard, Layers, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

/**
 * Single-column sidebar. The original screenshot had an extra icon
 * rail on the left (workspaces / analytics / support) but we only
 * have one workspace so the rail would be dead UI — removed.
 *
 * Each entry here is a real route. Add a new page → add a new entry.
 */

const pages = [
  { label: "Overview", href: "/" as const, icon: LayoutDashboard },
  { label: "Search", href: "/search" as const, icon: Search },
  { label: "Bulk", href: "/bulk" as const, icon: Layers },
  { label: "Companies", href: "/companies" as const, icon: Building2 },
  { label: "Annexe", href: "/annexe" as const, icon: Calculator },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[232px] shrink-0 border-r border-surface-line bg-surface px-3 py-5">
      <div className="rounded-xl bg-gradient-to-br from-brand-50 to-accent-equity-50/70 px-3 py-3 ring-1 ring-brand-100">
        <div className="text-[11px] font-semibold tracking-widest text-brand-800">
          ENRICHMENT
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-muted">
          Workspace
        </div>
      </div>

      <div className="mt-5 px-2 text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
        Pages
      </div>

      <ul className="mt-2 space-y-1">
        {pages.map((p) => {
          const active =
            pathname === p.href ||
            (p.href !== "/" && pathname.startsWith(p.href));
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-subtle transition",
                  active
                    ? "bg-brand-50 text-brand-700 shadow-card"
                    : "hover:bg-surface-sub hover:text-ink"
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-brand-500"
                  />
                )}
                <p.icon
                  className={cn(
                    "h-4 w-4 transition",
                    active ? "text-brand-600" : "group-hover:text-ink"
                  )}
                />
                <span>{p.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
