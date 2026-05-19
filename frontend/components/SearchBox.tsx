"use client";

import { Loader2, Search } from "lucide-react";
import { FormEvent } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  placeholder?: string;
};

export function SearchBox({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder = "Company name or 10-digit enterprise number…",
}: Props) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isLoading) onSubmit();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-3 rounded-card bg-surface px-4 py-3 shadow-card ring-1 ring-surface-line transition focus-within:ring-brand-300 focus-within:shadow-card-lift"
    >
      <Search className="h-4 w-4 text-ink-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
      />
      <button
        type="submit"
        disabled={isLoading || !value.trim()}
        className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-200 disabled:shadow-none"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Search className="h-4 w-4" />
        )}
        {isLoading ? "Searching…" : "Search"}
      </button>
    </form>
  );
}
