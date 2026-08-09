/**
 * Safe handling of untrusted URLs (Stage 4).
 *
 * Article/Source URLs are feed-derived and therefore untrusted. Only http(s)
 * URLs may become clickable links in the admin UI — a `javascript:`, `data:`,
 * or otherwise unparseable value must be rendered as inert text, never as an
 * anchor href. This pure helper is the single decision point, reused by the UI
 * and covered directly by tests.
 */
export function safeExternalUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
}
