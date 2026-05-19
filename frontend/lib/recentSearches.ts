/**
 * Recent-searches store, backed by localStorage.
 *
 * Keep the last 10 entries, de-duplicated by `query` (case-insensitive).
 * Latest entries win on conflict — re-running a query bumps it to the
 * top of the list rather than creating a second row.
 *
 * No backend persistence on purpose: this is per-browser, per-device
 * UX, not user-account state.
 */

export type RecentSearchStatus = "ok" | "ambiguous" | "not_found" | "error";

export type RecentSearch = {
  query: string;
  status: RecentSearchStatus;
  /** Set when status === "ok" — lets us link straight to the detail page. */
  enterprise_number?: string;
  /** Resolved display name when known. */
  resolved_name?: string;
  /** ISO timestamp of when the search ran. */
  searched_at: string;
};

const STORAGE_KEY = "flugia.recent-searches.v1";
const MAX_ENTRIES = 10;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function readRecents(): RecentSearch[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentSearch[]) : [];
  } catch {
    // Corrupt JSON, private-mode quota errors, etc. — treat as empty.
    return [];
  }
}

function writeRecents(list: RecentSearch[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* swallow */
  }
}

export function pushRecent(entry: RecentSearch): RecentSearch[] {
  if (!isBrowser()) return [];
  const list = readRecents();
  const key = entry.query.trim().toLowerCase();
  const filtered = list.filter((r) => r.query.trim().toLowerCase() !== key);
  const next = [entry, ...filtered].slice(0, MAX_ENTRIES);
  writeRecents(next);
  return next;
}

export function removeRecent(query: string): RecentSearch[] {
  if (!isBrowser()) return [];
  const key = query.trim().toLowerCase();
  const next = readRecents().filter(
    (r) => r.query.trim().toLowerCase() !== key
  );
  writeRecents(next);
  return next;
}

export function clearRecents(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* swallow */
  }
}
