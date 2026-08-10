import type { Metadata } from 'next';

import type { PublicationConfig } from './publication';

/**
 * Publication-aware metadata construction.
 *
 * Produces canonical URLs, titles, descriptions, Open Graph basics, and robots
 * directives from the active Publication and the request's base URL. Kept as a
 * pure function (no `headers()` access) so canonical/robots behaviour is directly
 * unit-testable. Callers resolve `{ config, baseUrl }` once per request (see
 * `getActivePublication`) and pass them in.
 *
 * It never fabricates authors, dates, ratings, or schema fields — only the
 * fields provided by the caller (drawn from real records) are emitted.
 */
export interface BuildMetadataInput {
  config: PublicationConfig;
  /** Absolute origin for canonical URLs, e.g. `https://example.com`. */
  baseUrl: string;
  /** Absolute request path beginning with `/` (no query for canonical). */
  path: string;
  /** Page title (site name is appended, except for the home page). */
  title?: string;
  description?: string;
  /** When false, emit `noindex` (e.g. search results, unavailable states). */
  index?: boolean;
  /** Open Graph type; defaults to `website`. */
  ogType?: 'website' | 'article';
  /**
   * Locale actually rendered (BCP-47), overriding the Publication default for
   * this page's `<html lang>`-equivalent metadata and OG locale. Used by
   * localisation-aware routes so a Malay Story page advertises `ms`, not the
   * Publication default.
   */
  locale?: string;
  /**
   * hreflang alternates: locale → absolute URL. Emitted as
   * `alternates.languages` so search engines can discover the localised
   * variants of the same Story within THIS Publication (never cross-domain).
   */
  languageAlternates?: Record<string, string>;
}

/** Join `baseUrl` and `path` into a clean absolute canonical URL. */
export function canonicalUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (!path || path === '/') return `${base}/`;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

/**
 * Serialize a value as JSON-LD script content with every `<` escaped to its
 * unicode form. This neutralises the only script-breakout sequences
 * (`</script`, `<!--`), so untrusted values embedded in structured data can
 * never terminate the `<script>` element or inject markup.
 */
export function jsonLdScriptContent(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function buildMetadata(input: BuildMetadataInput): Metadata {
  const { config, baseUrl, path } = input;
  const index = input.index ?? true;
  const description = input.description ?? config.description;
  const fullTitle = input.title
    ? `${input.title} — ${config.name}`
    : config.name;
  const url = canonicalUrl(baseUrl, path);
  const locale = input.locale ?? config.locale;
  const languages =
    input.languageAlternates && Object.keys(input.languageAlternates).length > 0
      ? input.languageAlternates
      : undefined;

  return {
    title: fullTitle,
    description,
    alternates: { canonical: url, languages },
    robots: {
      index,
      follow: true,
      googleBot: { index, follow: true },
    },
    openGraph: {
      type: input.ogType ?? 'website',
      siteName: config.name,
      title: fullTitle,
      description,
      url,
      locale,
    },
    twitter: {
      card: 'summary',
      title: fullTitle,
      description,
    },
  };
}
