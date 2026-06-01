"use client";

import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { useState } from "react";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

type Status = "idle" | "loading" | "error";

/**
 * Opens the stored annual-accounts PDF for one filing in a new tab.
 *
 * The bucket is private so we don't link directly to the storage URL.
 * Instead the button hits /api/companies/[cbe]/filings/[ref]/pdf to
 * get a freshly-signed URL on each click (1 hour TTL). This means a
 * stale page from yesterday still works, and the URL never appears
 * in a cached HTML response.
 *
 * 404 from the API → "No stored PDF for this filing" tooltip. The
 * user can hit Refresh on the company page to re-run the pipeline,
 * which uploads the PDF as it extracts.
 */
export function ViewPdfButton({
  cbe,
  reference,
  className,
}: {
  cbe: string;
  reference: string;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function openPdf() {
    setStatus("loading");
    setError(null);
    try {
      const { signed_url } = await api.getFilingPdfUrl(cbe, reference);
      window.open(signed_url, "_blank", "noopener,noreferrer");
      setStatus("idle");
    } catch (err) {
      let message =
        err instanceof Error ? err.message : "Couldn't load PDF";
      if (err instanceof ApiError) {
        if (err.status === 404) {
          message = "No stored PDF — refresh the company to retry.";
        } else if (err.status === 503) {
          message = "Supabase storage not configured.";
        }
      }
      setError(message);
      setStatus("error");
    }
  }

  const disabled = status === "loading";

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={openPdf}
        disabled={disabled}
        title={error ?? "Open the original annual accounts PDF"}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border border-surface-line bg-surface px-3 text-xs font-medium text-ink-subtle transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 disabled:cursor-wait disabled:opacity-70",
          status === "error" &&
            "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-50 hover:text-rose-700",
          className,
        )}
      >
        {status === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileText className="h-3.5 w-3.5" />
        )}
        View PDF
        {status !== "loading" && <ExternalLink className="h-3 w-3" />}
      </button>
      {status === "error" && error && (
        <span className="max-w-[16rem] truncate text-[10px] text-rose-700">
          {error}
        </span>
      )}
    </div>
  );
}
