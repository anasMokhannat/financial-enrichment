"use client";

import { Building2, CheckCircle2, Loader2, Save, Target } from "lucide-react";
import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import type { AppProfile } from "@/lib/types";

/**
 * Single-tenant profile page. Two sections:
 *   1. Your company  — what you are, what you sell, where you operate.
 *   2. Ideal customer profile — who you want to find. Free text so the
 *      analyzer can reason flexibly rather than us forcing rigid filter
 *      constraints.
 *
 * The analyzer reads the saved profile and biases its commercial-fit
 * verdict accordingly. Leaving the form empty falls back to the
 * financial-only judgement the analyzer used before.
 */

const EMPTY: AppProfile = {
  company_name: "",
  company_one_liner: "",
  offering: "",
  geo_focus: "",
  icp_description: "",
  icp_target_industries: "",
  icp_target_size: "",
  icp_disqualifiers: "",
  updated_at: null,
};

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export default function ProfilePage() {
  const [profile, setProfile] = useState<AppProfile>(EMPTY);
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await api.getProfile();
        if (!cancelled) {
          setProfile(p);
          setStatus({ kind: "ready" });
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? `API ${err.status}`
            : err instanceof Error
            ? err.message
            : "Unknown error";
        setStatus({ kind: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function set<K extends keyof AppProfile>(key: K, value: AppProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    try {
      const saved = await api.saveProfile(profile);
      setProfile(saved);
      setStatus({ kind: "saved" });
      setTimeout(() => setStatus({ kind: "ready" }), 2000);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `API ${err.status}`
          : err instanceof Error
          ? err.message
          : "Unknown error";
      setStatus({ kind: "error", message });
    }
  }

  if (status.kind === "loading") {
    return (
      <div className="mx-auto flex max-w-3xl items-center gap-2 text-sm text-ink-subtle">
        <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
        Loading profile…
      </div>
    );
  }

  const saving = status.kind === "saving";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-ink">Profile</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          Tell the analyzer who you are and who you want to reach. The
          commercial-fit verdict, ICP fit, and outreach hooks all use this
          context.
        </p>
      </header>

      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <section className="rounded-card border border-surface-line bg-surface px-5 py-4">
          <header className="mb-3 flex items-center gap-2 text-ink">
            <Building2 className="h-4 w-4 text-ink-muted" />
            <h2 className="text-sm font-semibold">Your company</h2>
          </header>

          <div className="grid grid-cols-1 gap-3">
            <Field
              label="Company name"
              value={profile.company_name}
              onChange={(v) => set("company_name", v)}
              placeholder="Flugia"
            />
            <Field
              label="One-liner"
              value={profile.company_one_liner}
              onChange={(v) => set("company_one_liner", v)}
              placeholder="We help logistics SMBs cut fuel costs by 15% with route-optimisation AI."
            />
            <TextArea
              label="Offering"
              value={profile.offering}
              onChange={(v) => set("offering", v)}
              placeholder="What you sell, how the buyer benefits, typical deal size, anything the AI should know to frame fit. 2–4 sentences is enough."
              rows={4}
            />
            <Field
              label="Geographic focus"
              value={profile.geo_focus}
              onChange={(v) => set("geo_focus", v)}
              placeholder="Belgium, Netherlands, Luxembourg"
            />
          </div>
        </section>

        <section className="rounded-card border border-surface-line bg-surface px-5 py-4">
          <header className="mb-3 flex items-center gap-2 text-ink">
            <Target className="h-4 w-4 text-ink-muted" />
            <h2 className="text-sm font-semibold">Ideal customer profile</h2>
          </header>

          <div className="grid grid-cols-1 gap-3">
            <TextArea
              label="Who you want to find"
              value={profile.icp_description}
              onChange={(v) => set("icp_description", v)}
              placeholder="The kind of company that buys from you and gets value fast. Industry, business model, common pain, etc."
              rows={4}
            />
            <Field
              label="Target industries / sectors"
              value={profile.icp_target_industries}
              onChange={(v) => set("icp_target_industries", v)}
              placeholder="Logistics, distribution, construction supply chain — or NACE codes if you prefer."
            />
            <Field
              label="Target size"
              value={profile.icp_target_size}
              onChange={(v) => set("icp_target_size", v)}
              placeholder="10–100 FTE, €1M–20M revenue"
            />
            <TextArea
              label="Disqualifiers"
              value={profile.icp_disqualifiers}
              onChange={(v) => set("icp_disqualifiers", v)}
              placeholder="Companies the analyzer should mark as 'no fit'. Examples: insolvent, recently dissolved, single-shareholder hobby companies."
              rows={3}
            />
          </div>
        </section>

        <div className="flex items-center justify-end gap-3">
          {status.kind === "error" && (
            <span className="text-xs text-rose-700">{status.message}</span>
          )}
          {status.kind === "saved" && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
          {profile.updated_at && status.kind === "ready" && (
            <span className="text-xs text-ink-muted">
              Last saved {new Date(profile.updated_at).toLocaleString()}
            </span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-brand-500 px-3.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-200"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 rounded-md border border-surface-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-brand-300 placeholder:text-ink-muted"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="resize-y rounded-md border border-surface-line bg-surface px-3 py-2 text-sm leading-relaxed text-ink outline-none transition focus:border-brand-300 placeholder:text-ink-muted"
      />
    </label>
  );
}
