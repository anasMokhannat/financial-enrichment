"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";

export type TabDef = {
  id: string;
  label: string;
};

type Props = {
  tabs: TabDef[];
  initial?: string;
  children: (active: string) => React.ReactNode;
  className?: string;
};

/**
 * Minimal controlled-tabs primitive. Brand-coloured underline for the
 * active tab; everything else stays in the muted palette. The render
 * prop pattern lets callers compose any content per tab.
 */
export function Tabs({ tabs, initial, children, className }: Props) {
  const [active, setActive] = useState<string>(initial ?? tabs[0]?.id ?? "");

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div
        role="tablist"
        className="flex gap-1 border-b border-surface-line"
      >
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              className={cn(
                "relative -mb-px px-4 py-2.5 text-sm font-medium transition",
                isActive
                  ? "text-brand-700"
                  : "text-ink-subtle hover:text-ink"
              )}
            >
              {t.label}
              {isActive && (
                <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-brand-500" />
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">{children(active)}</div>
    </div>
  );
}
