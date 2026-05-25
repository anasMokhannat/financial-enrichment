import { Search } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";

import { cn } from "@/lib/cn";

type Props = {
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: Route;
  className?: string;
};

/**
 * Header strip for the overview page. Clean title + caption on the
 * left, primary CTA on the right. No decorative artwork.
 */
export function HeroCard({
  title,
  subtitle,
  ctaLabel,
  ctaHref,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-between gap-4 rounded-card border border-surface-line bg-surface px-5 py-4 md:flex-row md:items-center",
        className,
      )}
    >
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-1 max-w-xl text-sm text-ink-subtle">{subtitle}</p>
      </div>
      <Link
        href={ctaHref}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-brand-500 px-3.5 text-sm font-medium text-white transition hover:bg-brand-600"
      >
        <Search className="h-3.5 w-3.5" />
        {ctaLabel}
      </Link>
    </div>
  );
}
