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
