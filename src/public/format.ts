/**
 * Presentation helpers for the public portal.
 *
 * Timestamps are stored in UTC; these render them deterministically without
 * assuming the server's local timezone. Kept pure and dependency-free so they
 * are trivially testable.
 */

/** A machine-readable ISO-8601 string for `<time dateTime>` / metadata, or null. */
export function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Compact absolute UTC label, e.g. `12 Aug 2026, 14:05 UTC`. Returns `null` for
 * an absent/invalid value so callers can decide how to render "unknown".
 */
export function formatUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm} UTC`;
}

/**
 * Coarse relative age ("just now", "3h ago", "2d ago") computed against `now`.
 * Deterministic given `now` (injected for tests). Returns null for invalid input.
 */
export function formatRelative(
  value: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return formatUtc(value);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/**
 * Trim untrusted excerpt text to a bounded length for display. Never renders
 * markup (the caller escapes it as text); this only limits length and collapses
 * whitespace so a hostile feed cannot blow out the layout. Returns null when
 * there is nothing to show.
 */
export function clampExcerpt(
  value: string | null | undefined,
  maxLength = 280,
): string | null {
  if (!value) return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  if (collapsed.length <= maxLength) return collapsed;
  // Cut on a word boundary where possible, then add an ellipsis.
  const slice = collapsed.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  const base = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${base.trimEnd()}…`;
}
