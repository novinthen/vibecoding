import { headers } from 'next/headers';

import { PublicationRepository } from '@/domain/repositories/publication-repository';

import { getDb, isDatabaseConfigured } from './db';
import {
  defaultPublicationConfig,
  normalizeHostname,
  resolvePublicationConfig,
  type PublicationConfig,
} from './publication';

/**
 * The resolved public request context: which Publication is being served and
 * the absolute base URL to build canonical/OG links from. Resolved once per
 * request (server-only; reads request headers).
 */
export interface ActivePublication {
  config: PublicationConfig;
  /** Absolute origin for canonical URLs, e.g. `https://example.com`. */
  baseUrl: string;
  /** The request host as received (with port in dev), or null. */
  host: string | null;
}

async function readHost(): Promise<string | null> {
  const store = await headers();
  // Prefer the forwarded host (set by proxies/Vercel) over the raw Host header.
  const value = store.get('x-forwarded-host') ?? store.get('host');
  return value?.trim() || null;
}

/** http for local development hosts; https everywhere else. Not hardcoded to a domain. */
function protocolForHost(host: string | null): string {
  if (!host) return 'https';
  const bare = host.replace(/:\d+$/, '');
  if (bare === 'localhost' || bare === '127.0.0.1' || bare.endsWith('.local')) {
    return 'http';
  }
  return 'https';
}

/**
 * Resolve the active Publication and base URL for the current request. Falls
 * back to the default Publication when no database is configured, no host is
 * present, or no Publication maps to the host — the portal always renders.
 */
export async function getActivePublication(): Promise<ActivePublication> {
  const host = await readHost();
  const normalized = normalizeHostname(host);

  let config = defaultPublicationConfig();
  if (isDatabaseConfigured() && normalized) {
    try {
      const repo = new PublicationRepository(getDb());
      const row = await repo.findByDomain(normalized);
      config = resolvePublicationConfig(row);
    } catch {
      // Resolution failures must never take down public rendering, and no
      // internal error detail is ever surfaced publicly. Use the default.
      config = defaultPublicationConfig();
    }
  }

  const baseUrl = host
    ? `${protocolForHost(host)}://${host}`
    : 'http://localhost:3000';

  return { config, baseUrl, host };
}
