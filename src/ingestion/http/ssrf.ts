import { isIP } from 'node:net';

import { IngestError } from './errors';

/**
 * SSRF protection for the feed fetcher.
 *
 * Feed URLs are untrusted input (docs/ARCHITECTURE.md). A malicious or
 * misconfigured Source must never be able to make the server reach internal
 * infrastructure (cloud metadata endpoints, localhost admin panels, private
 * ranges). Two layers are applied:
 *
 *  1. Structural: only http(s), no embedded credentials, no obvious
 *     internal hostnames — cheap and synchronous.
 *  2. Resolved-address: DNS-resolve the host and reject if ANY resolved address
 *     is private/reserved. This is enforced on the initial URL and on every
 *     redirect hop by the fetcher.
 *
 * Known limitation: DNS resolution here and the socket's later resolution are
 * separate lookups, so a determined attacker controlling authoritative DNS could
 * attempt a rebind between the two (TOCTOU). Fully closing that requires pinning
 * the connection to the validated IP; that hardening is deferred and documented
 * rather than silently omitted.
 */

/** Resolver seam so tests can supply deterministic address lists. */
export type HostResolver = (hostname: string) => Promise<string[]>;

export interface SsrfGuardOptions {
  /** DNS resolver; defaults to Node's `dns/promises` lookup (all addresses). */
  resolve?: HostResolver;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Structural URL validation. Returns a parsed URL or throws a classified
 * {@link IngestError}. Does not touch the network.
 */
export function assertSafeUrlShape(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (cause) {
    throw new IngestError('INVALID_URL', 'Malformed URL', {
      retryable: false,
      cause,
    });
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new IngestError(
      'SSRF_BLOCKED',
      `Blocked URL scheme: ${url.protocol}`,
      {
        retryable: false,
      },
    );
  }

  // Credentials in a feed URL are never legitimate and can smuggle auth to
  // internal endpoints.
  if (url.username || url.password) {
    throw new IngestError('SSRF_BLOCKED', 'URL must not embed credentials', {
      retryable: false,
    });
  }

  const host = url.hostname.toLowerCase();
  if (host.length === 0) {
    throw new IngestError('SSRF_BLOCKED', 'URL has no host', {
      retryable: false,
    });
  }
  // Obvious internal names that never resolve publicly.
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new IngestError('SSRF_BLOCKED', `Blocked internal host: ${host}`, {
      retryable: false,
    });
  }

  // A literal IP in the URL is validated immediately (no DNS needed).
  if (
    isIP(stripBrackets(host)) !== 0 &&
    isPrivateAddress(stripBrackets(host))
  ) {
    throw new IngestError('SSRF_BLOCKED', `Blocked private address: ${host}`, {
      retryable: false,
    });
  }

  return url;
}

/**
 * Full guard: structural checks plus DNS resolution, rejecting any host that
 * resolves to a private/reserved address. Returns the validated URL.
 */
export async function assertPublicUrl(
  rawUrl: string,
  options: SsrfGuardOptions = {},
): Promise<URL> {
  const url = assertSafeUrlShape(rawUrl);
  const host = stripBrackets(url.hostname.toLowerCase());

  // Literal IPs were already checked structurally; no DNS lookup to do.
  if (isIP(host) !== 0) return url;

  const resolve = options.resolve ?? defaultResolve;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch (cause) {
    // A host that does not resolve is a network failure, not an SSRF block.
    throw new IngestError('NETWORK', `DNS resolution failed for ${host}`, {
      retryable: true,
      cause,
    });
  }

  if (addresses.length === 0) {
    throw new IngestError('NETWORK', `No addresses resolved for ${host}`, {
      retryable: true,
    });
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new IngestError(
        'SSRF_BLOCKED',
        `Host ${host} resolves to a private address`,
        { retryable: false },
      );
    }
  }

  return url;
}

/** Default resolver: return every A/AAAA address for a hostname. */
async function defaultResolve(hostname: string): Promise<string[]> {
  const { lookup } = await import('node:dns/promises');
  const results = await lookup(hostname, { all: true });
  return results.map((entry) => entry.address);
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * True when an IP literal falls in a loopback, private, link-local, or otherwise
 * reserved range that must never be reached from a feed fetch.
 */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (
    parts.length !== 4 ||
    parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
  ) {
    return true; // Unparseable → treat as unsafe.
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

/**
 * Classify an IPv6 literal. Rather than match textual prefixes (which are
 * trivially bypassed by hex-normalized IPv4-mapped forms such as `::ffff:7f00:1`
 * ≡ `::ffff:127.0.0.1`, by leading-zero expansion, or by `::` compression), the
 * address is decoded to its eight 16-bit groups and classified numerically. Any
 * IPv4-mapped or IPv4-embedded address is validated against the IPv4 private
 * rules regardless of how it was written. An unparseable address is treated as
 * unsafe.
 */
function isPrivateIpv6(ip: string): boolean {
  const groups = parseIpv6Groups(ip);
  if (!groups) return true; // Unparseable → treat as unsafe.

  const allZeroHigh = groups.slice(0, 5).every((g) => g === 0);

  // ::ffff:a.b.c.d — IPv4-mapped. Validate the embedded IPv4 in any textual form.
  if (allZeroHigh && groups[5] === 0xffff) {
    return isPrivateIpv4(embeddedIpv4(groups));
  }

  // ::a.b.c.d — IPv4-compatible/embedded (incl. ::, ::1). The embedded IPv4
  // rules already flag 0.0.0.0/8 (covers :: and ::1) and every private range.
  if (allZeroHigh && groups[5] === 0) {
    return isPrivateIpv4(embeddedIpv4(groups));
  }

  const first = groups[0] ?? 0;
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10 link-local
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7 unique-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64 — reserved; validate any embedded IPv4.
  if (first === 0x64 && groups[1] === 0xff9b) return true;

  return false;
}

/** Reconstruct the IPv4 address embedded in the low 32 bits of an IPv6 group set. */
function embeddedIpv4(groups: number[]): string {
  const hi = groups[6] ?? 0;
  const lo = groups[7] ?? 0;
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

/**
 * Expand an IPv6 literal into eight 16-bit groups, handling `::` compression,
 * a dotted-quad IPv4 tail, leading zeros, and an optional zone id. Returns null
 * when the input is not a well-formed IPv6 address.
 */
function parseIpv6Groups(ip: string): number[] | null {
  // Drop any zone identifier (e.g. fe80::1%eth0).
  let addr = ip.toLowerCase().split('%')[0] ?? '';

  // Convert a trailing dotted-quad (IPv4 tail) into two hex groups.
  const lastColon = addr.lastIndexOf(':');
  const tail = lastColon >= 0 ? addr.slice(lastColon + 1) : addr;
  if (tail.includes('.')) {
    const octets = tail.split('.');
    if (octets.length !== 4) return null;
    const nums = octets.map((o) => Number(o));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const [a, b, c, d] = nums as [number, number, number, number];
    const hex = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    addr = addr.slice(0, lastColon + 1) + hex;
  }

  const doubleColonParts = addr.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (side === '') return [];
    const parts = side.split(':');
    const out: number[] = [];
    for (const part of parts) {
      if (part.length === 0 || part.length > 4 || !/^[0-9a-f]+$/.test(part)) {
        return null;
      }
      out.push(Number.parseInt(part, 16));
    }
    return out;
  };

  let groups: number[];
  if (doubleColonParts.length === 2) {
    const left = parseSide(doubleColonParts[0] ?? '');
    const right = parseSide(doubleColonParts[1] ?? '');
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null; // `::` must stand in for at least one group.
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    const only = parseSide(addr);
    if (!only) return null;
    groups = only;
  }

  return groups.length === 8 ? groups : null;
}
