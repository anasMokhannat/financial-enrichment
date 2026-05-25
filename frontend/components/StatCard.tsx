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
    <div className="rounded-card border border-surface-line bg-surface px-4 py-3.5 transition hover:border-brand-200">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "grid h-7 w-7 place-items-center rounded-md",
            style.iconBg,
          )}
        >
          <Icon className={cn("h-3.5 w-3.5", style.iconFg)} />
        </div>
        <div className="text-xs text-ink-muted">{label}</div>
      </div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      {caption && (
        <div className="mt-0.5 text-xs text-ink-muted">{caption}</div>
      )}
    </div>
  );
}
