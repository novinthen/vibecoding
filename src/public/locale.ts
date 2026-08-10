import { canonicalizeLocale } from '@/domain/locale';
import type {
  PublicStory,
  PublicStoryLocalization,
  PublishedStory,
} from './types';

/**
 * Public locale resolution policy (Stage 5B).
 *
 * Locale selection is deterministic and PUBLICATION-controlled. For Stage 5B the
 * domain determines the Publication; the locale is then chosen from, in order:
 *
 *   1. an explicit, well-formed `?locale=` request parameter, when present;
 *   2. the Publication's `default_locale`.
 *
 * Browser `Accept-Language` is deliberately NOT consulted — it must never
 * silently change the Publication or the served locale. An ill-formed requested
 * locale is ignored (never trusted), falling through to the default.
 *
 * Content fallback, once a locale is chosen, is equally deliberate (see
 * `resolveStoryContent`): an approved (PUBLISHED) StoryLocalization for the
 * chosen locale wins; otherwise the Publication's default locale localisation;
 * otherwise the Publication's own canonical publication copy. Content is never
 * borrowed from another locale beyond this rule, and never from another
 * Publication.
 */

/** Normalise a requested locale to canonical form, or null when ill-formed. */
export function normalizePublicLocale(
  input: string | string[] | undefined | null,
): string | null {
  const raw = Array.isArray(input) ? input[0] : input;
  if (!raw) return null;
  return canonicalizeLocale(raw);
}

/** Canonicalise a Publication default locale, falling back safely to `en`. */
export function canonicalDefaultLocale(defaultLocale: string): string {
  return canonicalizeLocale(defaultLocale) ?? 'en';
}

/**
 * The target locale for a request: a valid explicit request locale, else the
 * Publication default. Both are returned in canonical form.
 */
export function resolveTargetLocale(
  defaultLocale: string,
  requested: string | string[] | undefined | null,
): string {
  return (
    normalizePublicLocale(requested) ?? canonicalDefaultLocale(defaultLocale)
  );
}

/**
 * Merge an approved localisation over the base publication copy. Any null
 * localised field falls back to the base publication copy for THIS Publication
 * (never another locale or Publication). `resolvedLocale` is the locale actually
 * rendered — used for `<html lang>` / OG locale.
 */
export function mergeLocalizedStory(
  base: PublishedStory,
  localization: PublicStoryLocalization | null,
): PublicStory {
  return {
    id: base.id,
    slug: base.slug,
    title: localization?.headline ?? base.title,
    summary: localization?.summary ?? base.summary,
    whyItMatters: localization?.whyItMatters ?? base.whyItMatters,
    topicName: base.topicName,
    topicSlug: base.topicSlug,
    publishedAt: base.publishedAt,
    lastActivityAt: base.lastActivityAt,
  };
}
