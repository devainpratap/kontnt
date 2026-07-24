/**
 * Display helpers. The rule that matters here: unknown data renders as an
 * explicit dash, never as a zero. A blocked rank check and a rank of 0 are
 * different facts and must never look the same. See RANK_AGENTS.md.
 */

export const UNKNOWN = "—";

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return UNKNOWN;
  }
  return value.toLocaleString();
}

export function formatPosition(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return UNKNOWN;
  }
  return value.toFixed(1);
}

/** Relative time for "last synced" style labels. */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return "Never";
  }

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return UNKNOWN;
  }

  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(iso).toLocaleDateString();
}

/** Splits a comma/newline separated free-text field into trimmed entries. */
export function parseTermList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
