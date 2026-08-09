/**
 * Deterministic URL canonicalization for exact deduplication.
 *
 * The canonical URL is the dedup key: two links that point at the same resource
 * but differ only in tracking noise, casing, default ports, or fragments must
 * canonicalize to the same string. The rules are intentionally conservative —
 * we normalize what is provably safe and PRESERVE anything whose removal could
 * change which resource is addressed (docs/CURRENT_STAGE Stage 3 rule:
 * "preserve unknown query parameters unless proven irrelevant").
 *
 * Rules applied:
 *  - lowercase scheme and host; require http(s);
 *  - drop default ports (80/443);
 *  - drop the fragment (#...);
 *  - remove a single trailing slash except on the root path;
 *  - strip known tracking parameters (exact names + `utm_` / `utm_*` family);
 *  - keep every other query parameter, sorted for a stable key.
 *
 * Deliberately NOT applied (could merge distinct resources): stripping `www.`,
 * collapsing paths, decoding path segments, or dropping unknown params.
 */

/**
 * Exact query-parameter names that are pure tracking/analytics and never affect
 * which resource is returned. Compared case-insensitively.
 */
const TRACKING_PARAM_NAMES = new Set(
  [
    // Google / Urchin analytics
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'utm_name',
    'utm_reader',
    'utm_referrer',
    'utm_social',
    'utm_brand',
    // Click identifiers
    'gclid',
    'gclsrc',
    'dclid',
    'gbraid',
    'wbraid',
    'fbclid',
    'msclkid',
    'yclid',
    'twclid',
    'ttclid',
    'igshid',
    'igsh',
    // Mailchimp / email
    'mc_cid',
    'mc_eid',
    // Vendor referrers / sharing noise
    'ref',
    'ref_src',
    'ref_url',
    'referrer',
    'source',
    'cmpid',
    'campaign_id',
    'spm',
    'scm',
    '_hsenc',
    '_hsmi',
    'vero_id',
    'vero_conv',
    'oly_anon_id',
    'oly_enc_id',
    'hsa_cam',
    'piwik_campaign',
    'pk_campaign',
    'pk_kwd',
    'guccounter',
    // Feed-reader cache-busting
    'utm_cid',
  ].map((name) => name.toLowerCase()),
);

/** Prefixes whose entire family is tracking (e.g. any `utm_*`). */
const TRACKING_PARAM_PREFIXES = ['utm_'];

/** True when a query-parameter name is known tracking noise. */
export function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_PARAM_NAMES.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export class CanonicalUrlError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CanonicalUrlError';
  }
}

/**
 * Canonicalize `rawUrl`. Throws {@link CanonicalUrlError} for a non-parseable
 * URL or a non-http(s) scheme (callers ingesting feed links should treat that as
 * a skippable item rather than a whole-feed failure).
 */
export function canonicalizeUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (cause) {
    throw new CanonicalUrlError('Cannot parse URL', { cause });
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new CanonicalUrlError(`Unsupported URL scheme: ${protocol}`);
  }

  url.protocol = protocol;
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  // Drop default ports. The URL API already elides :80/:443 for the matching
  // scheme, but normalize explicitly so a cross-scheme default is handled too.
  if (
    (protocol === 'http:' && url.port === '80') ||
    (protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  // Remove tracking params, preserve the rest, and sort for a stable key.
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!isTrackingParam(key)) kept.push([key, value]);
  }
  kept.sort((a, b) =>
    a[0] === b[0] ? compare(a[1], b[1]) : compare(a[0], b[0]),
  );
  const search = new URLSearchParams();
  for (const [key, value] of kept) search.append(key, value);
  url.search = search.toString();

  // Normalize a single trailing slash except for the root path.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
    if (url.pathname === '') url.pathname = '/';
  }

  return url.toString();
}

/**
 * Canonicalize when possible; return the original string unchanged if it cannot
 * be canonicalized. Useful where a best-effort canonical form is wanted but the
 * raw URL must still be stored.
 */
export function tryCanonicalizeUrl(rawUrl: string): string {
  try {
    return canonicalizeUrl(rawUrl);
  } catch {
    return rawUrl;
  }
}

function compare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
