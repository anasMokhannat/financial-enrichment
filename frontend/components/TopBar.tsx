"use client";

import { useEffect, useState } from "react";

import { Logo } from "@/components/Logo";

/**
 * Top horizontal bar. We strip back to what's actually functional in
 * this build: the brand mark on the left, a live local clock in the
 * middle, the user chip on the right. The original screenshot's
 * command palette and notification centre are gone because nothing on
 * the page wires up to them.
 */
export function TopBar() {
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    function tick() {
      const d = new Date();
      setNow(
        d.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      );
    }
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex h-16 items-center justify-between border-b border-surface-line bg-surface px-6">
      <Logo />

      <div className="hidden text-xs text-ink-subtle md:flex md:items-center md:gap-2">
        <span suppressHydrationWarning>{now}</span>
        <span className="text-ink-muted">· Africa/Casablanca</span>
      </div>

      <span
        aria-hidden
        className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700"
      >
        AM
      </span>
    </header>
  );
}
