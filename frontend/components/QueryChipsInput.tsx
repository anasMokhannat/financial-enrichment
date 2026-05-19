"use client";

import { Hash, Type, X } from "lucide-react";
import {
  ClipboardEvent,
  KeyboardEvent,
  useId,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/cn";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  maxItems?: number;
};

/**
 * Pill-based multi-value input. Each query becomes a removable chip;
 * a thin inline input at the end is where the user types or pastes.
 *
 * Commit triggers (turn the draft into a chip):
 *   - Enter
 *   - Comma
 *   - Semicolon
 *   - Tab
 *   - Paste containing newlines / commas / semicolons (auto-splits)
 *
 * Erase triggers:
 *   - Backspace on an empty draft removes the last chip.
 *   - X on a chip removes that chip.
 *
 * The component renders names and CBE numbers with different chip
 * icons (Type vs Hash) so it's easy to scan a long list.
 */
export function QueryChipsInput({
  value,
  onChange,
  placeholder = "Type or paste a name or 10-digit CBE…",
  maxItems = 100,
}: Props) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  function commit(text: string) {
    const candidates = text
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (candidates.length === 0) {
      setDraft("");
      return;
    }
    const merged = [...value, ...candidates];
    // De-duplicate, case-insensitive, preserving first occurrence order.
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const item of merged) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
      if (deduped.length >= maxItems) break;
    }
    onChange(deduped);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
      if (draft.trim()) {
        e.preventDefault();
        commit(draft);
      }
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (/[\n,;]/.test(pasted)) {
      e.preventDefault();
      commit(draft + pasted);
    }
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
    inputRef.current?.focus();
  }

  function clearAll() {
    onChange([]);
    setDraft("");
    inputRef.current?.focus();
  }

  return (
    <div className="space-y-2">
      {/* Help line above the input */}
      <div className="flex items-center justify-between gap-3 text-[11px] text-ink-muted">
        <span>
          Press <Kbd>Enter</Kbd> or <Kbd>,</Kbd> to add. Paste a multi-line
          list to add many at once.
        </span>
        {value.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="font-medium text-ink-subtle transition hover:text-rose-700"
          >
            Clear all
          </button>
        )}
      </div>

      {/* The chip well */}
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-[140px] cursor-text flex-wrap items-start gap-2 rounded-card border border-surface-line bg-surface px-3 py-3 transition focus-within:border-brand-300 focus-within:shadow-card-lift focus-within:ring-2 focus-within:ring-brand-200/60"
      >
        {value.map((q, i) => (
          <Chip key={i} text={q} onRemove={() => removeAt(i)} />
        ))}
        <input
          ref={inputRef}
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={value.length === 0 ? placeholder : "Add another…"}
          className="min-w-[180px] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </div>
    </div>
  );
}

function Chip({ text, onRemove }: { text: string; onRemove: () => void }) {
  const isCbe = /^\d[\d.\s]{8,12}$/.test(text);
  const Icon = isCbe ? Hash : Type;
  return (
    <span
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1 text-xs font-medium ring-1 transition",
        isCbe
          ? "bg-accent-cash-50 text-accent-cash-700 ring-accent-cash-600/20 font-mono"
          : "bg-brand-50 text-brand-700 ring-brand-200"
      )}
    >
      <Icon className="h-3 w-3 shrink-0 opacity-70" />
      <span className="max-w-[220px] truncate">{text}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${text}`}
        className="ml-0.5 grid h-4 w-4 place-items-center rounded-full text-ink-muted transition hover:bg-white/60 hover:text-ink"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-surface-line bg-surface-sub px-1 py-0.5 font-mono text-[10px] font-semibold text-ink-subtle">
      {children}
    </kbd>
  );
}
