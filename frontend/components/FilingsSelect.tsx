"use client";

import { FileSpreadsheet } from "lucide-react";

import { cn } from "@/lib/cn";

const OPTIONS = [2, 5, 10, 15, 20] as const;

type Props = {
  value: number;
  onChange: (value: number) => void;
  className?: string;
};

/**
 * Compact select for "how many filings should the pipeline extract".
 * The backend caps at 20; 5 is the production-friendly default.
 */
export function FilingsSelect({ value, onChange, className }: Props) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 rounded-full bg-surface-sub px-3 py-1.5 text-sm text-ink-subtle",
        className
      )}
    >
      <FileSpreadsheet className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Filings
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-transparent text-sm font-semibold text-ink outline-none"
        aria-label="Number of filings to extract"
      >
        {OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
