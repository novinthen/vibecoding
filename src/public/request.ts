import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { appEnv } from '@/config/env';
import type { PublicationRow } from '@/domain/types';
import { PublicationRepository } from '@/domain/repositories/publication-repository';

import { getDb, isDatabaseConfigured } from './db';
import {
  normalizeHostname,
  resolvePublicationContext,
  type PublicationResolution,
  type ServedPublication,
} from './publication';

/**
 * Per-request Publication resolution (server-only; reads request headers).
 *
 * Resolution follows `hostname → enabled PublicationDomain → ACTIVE Publication`.
 * In production, a host that does not resolve fails closed (`unresolved`); in
 * local/preview it falls back to the in-code default so the portal is usable
 * before any Publication is configured. The decision itself lives in the pure
 * `resolvePublicationContext`; this module only supplies the header host, the DB
 * lookup, and the environment.
 */
async function readHost(): Promise<string | null> {
  const store = await headers();
  // Prefer the forwarded host (set by the platform/proxy) over the raw Host
  // header. Either way the value is untrusted: it is validated against the
  // PublicationDomain table before it can influence canonical metadata, and in
  // production an unrecognised host is rejected rather than trusted.
  const value = store.get('x-forwarded-host') ?? store.get('host');
  return value?.trim() || null;
}

function isProduction(): boolean {
  // APP_ENV is the deployment target (distinct from NODE_ENV): a preview
  // deployment runs a production build but is treated like development here so
  // its fallback stays practical. Only APP_ENV=production fails closed.
  return appEnv.APP_ENV === 'production';
}

/** Resolve the active Publication for the current request. */
export async function getActivePublication(): Promise<PublicationResolution> {
  const host = await readHost();
  const normalized = normalizeHostname(host);

  let row: PublicationRow | null = null;
  if (isDatabaseConfigured() && normalized) {
    try {
      row = await new PublicationRepository(getDb()).findByDomain(normalized);
    } catch {
      // A resolution failure must never take down rendering or leak internals;
      // treat it as "no match" and let the environment policy decide.
      row = null;
    }
  }

  return resolvePublicationContext({ host, row, isProduction: isProduction() });
}

/**
 * Resolve the served Publication or trigger a 404. Public routes call this so an
 * unresolved production host returns not-found instead of being served with a
 * default Publication or an unvalidated canonical host.
 */
export async function requireServedPublication(): Promise<ServedPublication> {
  const resolution = await getActivePublication();
  if (resolution.status === 'unresolved') {
    notFound();
  }
  return resolution;
}
