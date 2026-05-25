"use client";

import { Loader2, MapPin, Search } from "lucide-react";
import { FormEvent } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  postalCode: string;
  onPostalCodeChange: (v: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  placeholder?: string;
};

export function SearchBox({
  value,
  onChange,
  postalCode,
  onPostalCodeChange,
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
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <div className="flex h-10 flex-1 items-center gap-2 rounded-md border border-surface-line bg-surface px-3 transition focus-within:border-brand-300">
        <Search className="h-4 w-4 text-ink-muted" aria-hidden />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </div>

      <div className="flex h-10 items-center gap-2 rounded-md border border-surface-line bg-surface px-3 transition focus-within:border-brand-300 sm:w-36">
        <MapPin className="h-4 w-4 text-ink-muted" aria-hidden />
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          value={postalCode}
          onChange={(e) =>
            onPostalCodeChange(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          placeholder="Postcode"
          aria-label="Postal code (4 digits)"
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading || !value.trim()}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand-500 px-4 text-sm font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-200"
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
