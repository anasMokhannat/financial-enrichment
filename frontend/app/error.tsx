"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useEffect } from "react";

/**
 * Top-level error boundary. Renders when any route below crashes
 * (render error in a server component, thrown error in a client
 * component, fetch failure not caught locally, etc.). The user gets a
 * non-broken page with a Retry that calls Next's `reset()`.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface in the dev console; in production this is where we'd
    // ship the error to Sentry / Logflare / etc.
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-card bg-surface px-6 py-12 text-center shadow-card ring-1 ring-surface-line">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-ink">
          Something went wrong
        </h1>
        <p className="mt-1 text-sm text-ink-subtle">
          {error.message || "Unexpected error."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-ink-muted">
            digest {error.digest}
          </p>
        )}
      </div>
      <button
        onClick={reset}
        className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
      >
        <RotateCw className="h-4 w-4" />
        Try again
      </button>
    </div>
  );
}
