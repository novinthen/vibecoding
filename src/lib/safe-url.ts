/**
 * Safe handling of untrusted URLs.
 *
 * Article/Source URLs are feed-derived and therefore untrusted (see
 * docs/ARCHITECTURE.md security boundaries). Only http(s) URLs may ever become
 * clickable links; a `javascript:`, `data:`, or otherwise unparseable value must
 * be rendered as inert text, never as an anchor href. This pure helper is the
 * single decision point, shared by the admin surface and the public portal and
 * covered directly by tests.
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

/**
 * Return the registrable-ish hostname of an untrusted URL for compact display
 * (e.g. "example.com" from "https://example.com/a/b?c=1"), or null when the URL
 * is not a safe http(s) URL. A leading "www." is dropped. Never throws.
 */
export function displayHost(value: string | null | undefined): string | null {
  const safe = safeExternalUrl(value);
  if (!safe) return null;
  try {
    return new URL(safe).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
