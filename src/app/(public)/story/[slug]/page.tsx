import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getStoryPage, type StoryPage } from '@/public/content';
import { getDb, isDatabaseConfigured } from '@/public/db';
import { clampExcerpt, formatUtc } from '@/public/format';
import { canonicalUrl, buildMetadata } from '@/public/metadata';
import { requireServedPublication } from '@/public/request';
import type { ServedPublication } from '@/public/publication';

import { ArticleList, PageHeading } from '../../_components/ui';

/**
 * Public Story route — publication- and localisation-aware (Stage 5B).
 *
 * Resolves a Story only when a real PublicationStory (PUBLISHED) exists for the
 * active Publication, and 404s otherwise. The rendered locale follows the
 * documented policy (valid `?locale=` else the Publication default), and content
 * comes from an approved StoryLocalization when available, otherwise the
 * Publication's own canonical publication copy — never another Publication's
 * localisation. Content is drawn from real editorial/canonical fields only.
 */
export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;
type Search = Promise<{ locale?: string | string[] }>;

async function load(
  served: ServedPublication,
  slug: string,
  requestedLocale: string | string[] | undefined,
): Promise<StoryPage | null> {
  if (!isDatabaseConfigured()) return null;
  return getStoryPage(
    getDb(),
    served.config.id,
    served.config.locale,
    slug,
    requestedLocale,
  );
}

/** Build the hreflang alternates for a Story's approved locales within this Publication. */
function localeAlternates(
  baseUrl: string,
  slug: string,
  defaultLocale: string,
  available: string[],
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const loc of available) {
    // The default locale is served at the bare path; other locales at ?locale=.
    languages[loc] =
      loc === defaultLocale
        ? canonicalUrl(baseUrl, `/story/${slug}`)
        : canonicalUrl(baseUrl, `/story/${slug}?locale=${loc}`);
  }
  return languages;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  readonly params: Params;
  readonly searchParams: Search;
}): Promise<Metadata> {
  const { slug } = await params;
  const { locale: requestedLocale } = await searchParams;
  const served = await requireServedPublication();
  const { config, baseUrl } = served;
  const data = await load(served, slug, requestedLocale);
  if (!data) {
    return buildMetadata({
      config,
      baseUrl,
      path: `/story/${slug}`,
      title: 'Story not found',
      index: false,
    });
  }
  // Canonical points at the exact rendered variant so localised views don't
  // duplicate the default. Alternates cover the approved locales for THIS
  // Publication only (never cross-domain).
  const isDefault = data.resolvedLocale === config.locale;
  const path = isDefault
    ? `/story/${data.story.slug}`
    : `/story/${data.story.slug}?locale=${data.resolvedLocale}`;
  return buildMetadata({
    config,
    baseUrl,
    path,
    title: data.story.title,
    description:
      clampExcerpt(data.story.summary, 200) ??
      `A developing story on ${config.name}.`,
    ogType: 'article',
    locale: data.resolvedLocale,
    languageAlternates: localeAlternates(
      baseUrl,
      data.story.slug,
      config.locale,
      data.availableLocales,
    ),
  });
}

export default async function StoryPageRoute({
  params,
  searchParams,
}: {
  readonly params: Params;
  readonly searchParams: Search;
}) {
  const { slug } = await params;
  const { locale: requestedLocale } = await searchParams;
  const served = await requireServedPublication();
  const data = await load(served, slug, requestedLocale);
  if (!data) notFound();

  const { story, articles, resolvedLocale } = data;
  const published = formatUtc(story.publishedAt ?? story.lastActivityAt);

  return (
    // lang marks the rendered locale for assistive tech / SEO even though the
    // root <html lang> reflects the Publication default.
    <article className="mx-auto max-w-3xl" lang={resolvedLocale}>
      <PageHeading
        kicker="Story"
        title={story.title}
        description={
          story.topicName && story.topicSlug ? (
            <Link
              href={`/topic/${story.topicSlug}`}
              className="hover:underline"
            >
              {story.topicName}
            </Link>
          ) : undefined
        }
      />
      {published ? (
        <p className="-mt-3 mb-4 text-sm text-neutral-500">{published}</p>
      ) : null}

      {data.availableLocales.length > 0 ? (
        <LocaleSwitcher
          slug={story.slug}
          defaultLocale={served.config.locale}
          resolvedLocale={resolvedLocale}
          available={data.availableLocales}
        />
      ) : null}

      {story.summary ? (
        <p className="text-[0.95rem] leading-relaxed text-neutral-800 dark:text-neutral-200">
          {story.summary}
        </p>
      ) : null}

      {story.whyItMatters ? (
        <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Why it matters
          </h2>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            {story.whyItMatters}
          </p>
        </div>
      ) : null}

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
        Coverage
      </h2>
      <ArticleList
        articles={articles}
        emptyLabel="No source articles are linked to this story yet."
      />
    </article>
  );
}

/**
 * Language switcher across the Story's approved locales within this Publication.
 * Deterministic and publication-controlled: only locales with a PUBLISHED
 * localisation (plus the default publication copy) appear.
 */
function LocaleSwitcher({
  slug,
  defaultLocale,
  resolvedLocale,
  available,
}: {
  readonly slug: string;
  readonly defaultLocale: string;
  readonly resolvedLocale: string;
  readonly available: readonly string[];
}) {
  const locales = Array.from(new Set([defaultLocale, ...available]));
  return (
    <nav
      aria-label="Available languages"
      className="mb-4 flex flex-wrap items-center gap-2 text-xs"
    >
      <span className="text-neutral-500">Languages:</span>
      {locales.map((loc) => {
        const href =
          loc === defaultLocale
            ? `/story/${slug}`
            : `/story/${slug}?locale=${loc}`;
        const active = loc === resolvedLocale;
        return (
          <Link
            key={loc}
            href={href}
            hrefLang={loc}
            aria-current={active ? 'true' : undefined}
            className={
              active
                ? 'rounded bg-neutral-900 px-2 py-0.5 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'rounded px-2 py-0.5 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
            }
          >
            {loc}
          </Link>
        );
      })}
    </nav>
  );
}
