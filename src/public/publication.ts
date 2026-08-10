import { appEnv } from '@/config/env';
import type { PublicationRow } from '@/domain/types';

/**
 * Publication resolution for the public portal.
 *
 * The platform is multi-publication by design: one canonical backend powers many
 * sites/brands/locales, resolved per request as
 * `hostname → PublicationDomain → Publication → public config`. Canonical domain
 * logic must never hardcode a single domain, brand, or locale (CLAUDE.md rules
 * 14–17).
 *
 * Stage 5 implements the minimum clean resolution seam:
 *   - `normalizeHostname` + `PublicationRepository.findByDomain` do the lookup;
 *   - `resolvePublicationConfig` projects a Publication row into the small,
 *     render-facing `PublicationConfig`;
 *   - `defaultPublicationConfig` is the sensible development/default fallback so
 *     the portal renders before any Publication is configured — WITHOUT inventing
 *     a database row.
 *
 * The full Stage 5B localisation workflow (StoryLocalization, per-publication
 * sitemaps/RSS, translation review) is intentionally out of scope here.
 */
export interface PublicationConfig {
  /** Stable slug; `'default'` for the in-code fallback. */
  slug: string;
  /** Real Publication id when resolved from the database, else null. */
  id: string | null;
  name: string;
  /** BCP-47-ish locale used for `<html lang>` and metadata. */
  locale: string;
  timezone: string;
  tagline: string | null;
  /** Default meta description; page-specific descriptions override it. */
  description: string;
  /** Provenance of this config — for honest diagnostics, never a secret. */
  source: 'database' | 'default';
}

const FALLBACK_DESCRIPTION =
  'Independent news and intelligence for the vibe-coding ecosystem: ' +
  'AI coding tools, agents, MCP, models, releases, and developer signals.';

/**
 * The development/default Publication used when no Publication is configured for
 * the request hostname. The site name comes from the validated environment
 * (`NEXT_PUBLIC_APP_NAME`), not a hardcoded brand, so a deployment can set its
 * own name without a database row.
 */
export function defaultPublicationConfig(): PublicationConfig {
  return {
    slug: 'default',
    id: null,
    name: appEnv.NEXT_PUBLIC_APP_NAME,
    locale: 'en',
    timezone: 'UTC',
    tagline: null,
    description: FALLBACK_DESCRIPTION,
    source: 'default',
  };
}

/**
 * Normalise a request hostname for domain lookup: lowercase and strip any
 * `:port` suffix. Domains are matched EXACTLY against `publication_domains`
 * (a leading `www.` is significant), so it is deliberately not stripped here.
 * Returns null for empty/absent input.
 */
export function normalizeHostname(
  host: string | null | undefined,
): string | null {
  if (!host) return null;
  const lowered = host.trim().toLowerCase();
  if (!lowered) return null;
  // Remove a trailing :port (host header form `example.com:3000`).
  const withoutPort = lowered.replace(/:\d+$/, '');
  return withoutPort || null;
}

/**
 * The outcome of resolving a request to a Publication.
 *
 * - `database`: the host matched an ENABLED PublicationDomain on an ACTIVE
 *   Publication. The canonical base uses that validated host — never an
 *   unvalidated request header.
 * - `default`: no Publication matched, but the environment (local/preview)
 *   permits the in-code default Publication so the portal is usable before any
 *   Publication is configured.
 * - `unresolved`: production received a host that does not resolve to a
 *   Publication. The portal fails closed (404/unavailable); no default is served
 *   and no canonical/OG URL is derived from the unrecognised host.
 */
export type PublicationResolution =
  | {
      status: 'database';
      config: PublicationConfig;
      baseUrl: string;
      host: string;
    }
  | {
      status: 'default';
      config: PublicationConfig;
      baseUrl: string;
      host: string | null;
    }
  | { status: 'unresolved'; host: string | null };

/** A resolution that is actually served (database or default). */
export type ServedPublication = Extract<
  PublicationResolution,
  { status: 'database' | 'default' }
>;

/** http for local development hosts; https everywhere else. Never hardcodes a domain. */
export function protocolForHost(host: string): string {
  const bare = host.replace(/:\d+$/, '');
  if (bare === 'localhost' || bare === '127.0.0.1' || bare.endsWith('.local')) {
    return 'http';
  }
  return 'https';
}

function baseUrlForHost(host: string): string {
  return `${protocolForHost(host)}://${host}`;
}

/**
 * Pure resolution decision, separated from request/DB access so every branch is
 * directly unit-testable.
 *
 * @param host    the raw request host (already read from headers), or null.
 * @param row     the PublicationDomain→Publication lookup result (already run by
 *                the caller when a database is configured), or null.
 * @param isProduction  whether this is a production deployment (APP_ENV).
 */
export function resolvePublicationContext(input: {
  host: string | null;
  row: PublicationRow | null;
  isProduction: boolean;
}): PublicationResolution {
  const { host, row, isProduction } = input;
  const normalized = normalizeHostname(host);

  if (row) {
    // The host passed PublicationDomain resolution. Build the canonical base
    // from the VALIDATED normalised domain, not the raw header, so an untrusted
    // Host/X-Forwarded-Host value can never poison canonical metadata.
    const canonicalHost = normalized ?? row.slug;
    return {
      status: 'database',
      config: resolvePublicationConfig(row),
      baseUrl: baseUrlForHost(canonicalHost),
      host: canonicalHost,
    };
  }

  // No Publication resolved for this host.
  if (isProduction) {
    // Fail closed: do not serve the default Publication, and do not derive a
    // canonical/OG URL from the unrecognised host.
    return { status: 'unresolved', host };
  }

  // Local/preview: the in-code default keeps development practical.
  const baseUrl = host ? baseUrlForHost(host) : 'http://localhost:3000';
  return {
    status: 'default',
    config: defaultPublicationConfig(),
    baseUrl,
    host,
  };
}

function readString(
  obj: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = obj?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Project a resolved Publication row (with its JSONB branding/SEO settings) into
 * the render-facing config. Missing/blank optional fields fall back to safe
 * defaults. `null` → the in-code default Publication.
 */
export function resolvePublicationConfig(
  row: PublicationRow | null,
): PublicationConfig {
  if (!row) return defaultPublicationConfig();
  return {
    slug: row.slug,
    id: row.id,
    name: readString(row.branding, 'name') ?? row.name,
    locale: row.default_locale?.trim() || 'en',
    timezone: row.timezone?.trim() || 'UTC',
    tagline: readString(row.branding, 'tagline'),
    description:
      readString(row.seo_settings, 'description') ?? FALLBACK_DESCRIPTION,
    source: 'database',
  };
}
