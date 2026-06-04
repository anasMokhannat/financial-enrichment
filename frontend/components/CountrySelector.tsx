"use client";

import { cn } from "@/lib/cn";
import type { Country } from "@/lib/types";

/**
 * Two-chip country selector shown above the search box. Drives:
 *   - which input format the search expects (CBE 10-digit vs SIREN 9-digit)
 *   - which back-end pipeline runs (KBO + NBB vs INPI)
 *   - whether the postcode input is meaningful (BE only).
 *
 * Belgium is the historical default. Adding more countries later means
 * extending the OPTIONS list + the pipeline dispatch.
 */

const OPTIONS: Array<{
  code: Country;
  label: string;
  flag: string;
  hint: string;
}> = [
  { code: "BE", label: "Belgium", flag: "🇧🇪", hint: "KBO / NBB" },
  { code: "FR", label: "France", flag: "🇫🇷", hint: "INPI" },
];

type Props = {
  value: Country;
  onChange: (value: Country) => void;
};

export function CountrySelector({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-ink-muted">Country</span>
      <div
        role="radiogroup"
        aria-label="Country to search in"
        className="inline-flex items-center gap-1 rounded-md border border-surface-line bg-surface p-1"
      >
        {OPTIONS.map((opt) => {
          const active = opt.code === value;
          return (
            <button
              key={opt.code}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.code)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-ink-subtle hover:bg-surface-sub hover:text-ink",
              )}
            >
              <span aria-hidden className="text-sm leading-none">
                {opt.flag}
              </span>
              <span>{opt.label}</span>
              <span className="text-[10px] text-ink-muted">· {opt.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
