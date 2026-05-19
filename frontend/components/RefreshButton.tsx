"use client";

import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";

type Status = "idle" | "loading" | "done" | "error";

/**
 * Pressing this button POSTs /companies/{cbe}/refresh on the backend,
 * which re-runs the pipeline against KBO + NBB + the LLM extractor
 * and writes the fresh result back to Supabase. We then call
 * `router.refresh()` so the server-rendered parent page re-fetches
 * the updated data without a hard reload.
 */
export function RefreshButton({ cbe }: { cbe: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setStatus("loading");
    setError(null);
    try {
      await api.refreshCompany(cbe);
      router.refresh();
      setStatus("done");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `API ${err.status}`
          : err instanceof Error
          ? err.message
          : "Unknown error";
      setError(msg);
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "loading"}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition",
          status === "done"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : status === "error"
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-surface-line bg-surface text-ink-subtle hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700",
          status === "loading" && "cursor-wait opacity-70"
        )}
      >
        {status === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : status === "done" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {status === "loading"
          ? "Refreshing…"
          : status === "done"
          ? "Refreshed"
          : "Refresh"}
      </button>
      {error && (
        <span className="text-xs text-rose-700">{error}</span>
      )}
    </div>
  );
}
