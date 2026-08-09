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

function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === '::' || addr === '::1') return true; // unspecified / loopback
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4 address.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped && mapped[1]) return isPrivateIpv4(mapped[1]);
  if (addr.startsWith('fe80')) return true; // link-local
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // fc00::/7 unique-local
  if (addr.startsWith('ff')) return true; // multicast
  return false;
}
