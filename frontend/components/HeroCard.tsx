import { Search, Sparkles } from "lucide-react";
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
 * Hero banner: gradient background with two soft decorative circles to
 * add depth without an actual illustration. Title + caption on the
 * left, primary CTA on the right.
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
        "relative overflow-hidden rounded-card bg-hero-gradient px-8 py-8 shadow-card ring-1 ring-surface-line",
        className
      )}
    >
      {/* Decorative blobs — purely visual, hidden from screen readers. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand-200/40 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 right-32 h-40 w-40 rounded-full bg-accent-equity-50/80 blur-3xl"
      />

      <div className="relative flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-brand-700 backdrop-blur">
            <Sparkles className="h-3 w-3" />
            Enrichment workspace
          </span>
          <h1 className="mt-3 text-3xl font-bold text-ink">{title}</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-subtle">{subtitle}</p>
        </div>
        <Link
          href={ctaHref}
          className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:bg-brand-600 hover:shadow-card-lift"
        >
          <Search className="h-4 w-4" />
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
