import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Six accent palettes that map to the six stat-card variants.
 * Adding a new colour means adding an entry here and a new
 * `bg-card-tint-*` gradient in tailwind.config.ts.
 */
const ACCENT_STYLES = {
  cyan: {
    tint: "bg-card-tint-cyan",
    iconBg: "bg-brand-100/80",
    iconFg: "text-brand-700",
  },
  emerald: {
    tint: "bg-card-tint-emerald",
    iconBg: "bg-accent-profit-50",
    iconFg: "text-accent-profit-700",
  },
  violet: {
    tint: "bg-card-tint-violet",
    iconBg: "bg-accent-equity-50",
    iconFg: "text-accent-equity-700",
  },
  orange: {
    tint: "bg-card-tint-orange",
    iconBg: "bg-accent-debt-50",
    iconFg: "text-accent-debt-700",
  },
  rose: {
    tint: "bg-card-tint-rose",
    iconBg: "bg-accent-people-50",
    iconFg: "text-accent-people-700",
  },
  slate: {
    tint: "",
    iconBg: "bg-surface-sub",
    iconFg: "text-ink-subtle",
  },
} as const;

export type StatAccent = keyof typeof ACCENT_STYLES;

type Props = {
  icon: LucideIcon;
  value: string | number;
  label: string;
  caption?: string;
  accent?: StatAccent;
};

/**
 * Tile that goes in the row under the hero. Icon chip top-left in
 * the accent colour; large value; small label; optional caption.
 * Slight scale-up on hover for affordance.
 */
export function StatCard({
  icon: Icon,
  value,
  label,
  caption,
  accent = "cyan",
}: Props) {
  const style = ACCENT_STYLES[accent];
  return (
    <div
      className={cn(
        "group relative rounded-card px-6 py-6 shadow-card ring-1 ring-surface-line transition",
        "hover:-translate-y-0.5 hover:shadow-card-lift",
        style.tint || "bg-surface"
      )}
    >
      <div
        className={cn(
          "mb-4 grid h-11 w-11 place-items-center rounded-xl transition-transform group-hover:scale-105",
          style.iconBg
        )}
      >
        <Icon className={cn("h-5 w-5", style.iconFg)} />
      </div>
      <div className="text-3xl font-bold text-ink">{value}</div>
      <div className="mt-1 text-sm font-medium text-ink-subtle">{label}</div>
      {caption && (
        <div className="mt-1 text-xs text-ink-muted">{caption}</div>
      )}
    </div>
  );
}
