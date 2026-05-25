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
    <aside className="w-[216px] shrink-0 border-r border-surface-line bg-surface px-3 py-4">
      <div className="px-3 pb-3 text-sm font-semibold text-ink">
        Enrichment
      </div>

      <ul className="space-y-0.5">
        {pages.map((p) => {
          const active =
            pathname === p.href ||
            (p.href !== "/" && pathname.startsWith(p.href));
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                className={cn(
                  "group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-subtle hover:bg-surface-sub hover:text-ink",
                )}
              >
                <p.icon
                  className={cn(
                    "h-4 w-4 transition",
                    active ? "text-brand-600" : "text-ink-muted group-hover:text-ink",
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
