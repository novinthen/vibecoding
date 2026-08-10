import { describe, expect, it } from 'vitest';

import type { PublicationRow } from '@/domain/types';
import {
  resolvePublicationContext,
  type PublicationResolution,
} from '@/public/publication';

/**
 * Production must fail closed for unknown hostnames: an unrecognised host is
 * never served with the default Publication, and no canonical/OG URL is derived
 * from it. Local/preview keeps a practical default fallback. This exercises the
 * pure decision directly (the DB lookup and header read are wired separately).
 */
function activeRow(overrides: Partial<PublicationRow> = {}): PublicationRow {
  return {
    id: 'pub-1',
    name: 'Global EN',
    slug: 'global-en',
    default_locale: 'en',
    timezone: 'UTC',
    status: 'ACTIVE',
    editorial_profile: {},
    branding: {},
    seo_settings: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function expectStatus<S extends PublicationResolution['status']>(
  r: PublicationResolution,
  status: S,
): Extract<PublicationResolution, { status: S }> {
  expect(r.status).toBe(status);
  return r as Extract<PublicationResolution, { status: S }>;
}

describe('resolvePublicationContext', () => {
  it('serves a resolved Publication (row present) in production', () => {
    const r = resolvePublicationContext({
      host: 'news.example.com',
      row: activeRow(),
      isProduction: true,
    });
    const served = expectStatus(r, 'database');
    expect(served.config.slug).toBe('global-en');
    expect(served.baseUrl).toBe('https://news.example.com');
  });

  it('builds the canonical base from the validated host, not the raw header', () => {
    // A mixed-case host with a port still yields a clean, normalised canonical
    // base — the header value cannot poison canonical metadata.
    const r = resolvePublicationContext({
      host: 'NEWS.Example.COM:8080',
      row: activeRow(),
      isProduction: true,
    });
    const served = expectStatus(r, 'database');
    expect(served.baseUrl).toBe('https://news.example.com');
    expect(served.host).toBe('news.example.com');
  });

  it('falls back to the default Publication for an unknown host in development', () => {
    const r = resolvePublicationContext({
      host: 'anything.local:3000',
      row: null,
      isProduction: false,
    });
    const served = expectStatus(r, 'default');
    expect(served.config.source).toBe('default');
    // Dev canonical may use the request host; http for a local host.
    expect(served.baseUrl).toBe('http://anything.local:3000');
  });

  it('FAILS CLOSED for an unknown host in production', () => {
    const r = resolvePublicationContext({
      host: 'evil.attacker.example',
      row: null,
      isProduction: true,
    });
    expectStatus(r, 'unresolved');
    // No config and no baseUrl are exposed — nothing canonical can be built.
    expect('config' in r).toBe(false);
    expect('baseUrl' in r).toBe(false);
  });

  it('does not derive canonical metadata from an unrecognised production host', () => {
    const r = resolvePublicationContext({
      host: 'unregistered.example',
      row: null,
      isProduction: true,
    });
    expect(r.status).toBe('unresolved');
    // The only field carried is the (still untrusted) host, for diagnostics —
    // never a baseUrl a page could turn into a canonical/OG URL.
    expect(JSON.stringify(r)).not.toContain('http');
  });

  it('a missing host in development still yields a usable default base', () => {
    const r = resolvePublicationContext({
      host: null,
      row: null,
      isProduction: false,
    });
    const served = expectStatus(r, 'default');
    expect(served.baseUrl).toBe('http://localhost:3000');
  });
});
