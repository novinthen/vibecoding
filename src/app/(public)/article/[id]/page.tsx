import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { safeExternalUrl, displayHost } from '@/lib/safe-url';
import { getArticle } from '@/public/content';
import { getDb, isDatabaseConfigured } from '@/public/db';
import { clampExcerpt, formatUtc, isoOrNull } from '@/public/format';
import { buildMetadata, jsonLdScriptContent } from '@/public/metadata';
import { getActivePublication } from '@/public/request';
import type { PublicArticleDetail } from '@/public/types';

import { AuthorityBadge, OutboundLink } from '../../_components/ui';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

async function loadArticle(id: string): Promise<PublicArticleDetail | null> {
  if (!isDatabaseConfigured()) return null;
  return getArticle(getDb(), id);
}

export async function generateMetadata({
  params,
}: {
  readonly params: Params;
}): Promise<Metadata> {
  const { id } = await params;
  const { config, baseUrl } = await getActivePublication();
  const article = await loadArticle(id);
  if (!article) {
    return buildMetadata({
      config,
      baseUrl,
      path: `/article/${id}`,
      title: 'Article not found',
      index: false,
    });
  }
  return buildMetadata({
    config,
    baseUrl,
    path: `/article/${article.id}`,
    title: article.title,
    description:
      clampExcerpt(article.excerpt, 200) ??
      `Coverage from ${article.sourceName} on ${config.name}.`,
    ogType: 'article',
  });
}

export default async function ArticlePage({
  params,
}: {
  readonly params: Params;
}) {
  const { id } = await params;
  const article = await loadArticle(id);
  if (!article) notFound();

  const published = formatUtc(article.publishedAt ?? article.discoveredAt);
  const originalHost = displayHost(article.url);
  const bodyText = article.cleanText?.trim() || null;
  const excerpt = article.cleanText ? null : clampExcerpt(article.excerpt, 600);

  return (
    <article className="mx-auto max-w-3xl">
      <nav className="mb-4 text-xs text-neutral-500">
        <Link href="/latest" className="hover:underline">
          ← Latest
        </Link>
      </nav>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
        <AuthorityBadge tier={article.authorityTier} />
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {article.sourceName}
        </span>
        {article.topicName && article.topicSlug ? (
          <>
            <span aria-hidden>·</span>
            <Link
              href={`/topic/${article.topicSlug}`}
              className="hover:underline"
            >
              {article.topicName}
            </Link>
          </>
        ) : null}
      </div>

      <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
        {article.title}
      </h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-500">
        {published ? (
          <span>
            {article.publishedAt ? 'Published' : 'Ingested'} {published}
          </span>
        ) : null}
        {article.author ? <span>By {article.author}</span> : null}
      </div>

      <div className="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-neutral-600 dark:text-neutral-400">
          This is an aggregated reference. Read the full, original article at
          the source:
        </p>
        <p className="mt-1.5">
          <OutboundLink
            href={article.url}
            className="font-semibold text-sky-700 hover:underline dark:text-sky-400"
          >
            {originalHost
              ? `${article.sourceName} — ${originalHost}`
              : article.sourceName}{' '}
            →
          </OutboundLink>
        </p>
      </div>

      {bodyText ? (
        <div className="mt-6 whitespace-pre-wrap text-[0.95rem] leading-relaxed text-neutral-800 dark:text-neutral-200">
          {bodyText}
        </div>
      ) : excerpt ? (
        <p className="mt-6 text-[0.95rem] leading-relaxed text-neutral-800 dark:text-neutral-200">
          {excerpt}
        </p>
      ) : (
        <p className="mt-6 text-sm text-neutral-500">
          No excerpt is available for this item. Use the source link above to
          read the original.
        </p>
      )}

      <div className="mt-8 border-t border-neutral-200 pt-4 text-xs text-neutral-500 dark:border-neutral-800">
        Source: {article.sourceName}
        {safeExternalUrl(article.sourceHomepageUrl) ? (
          <>
            {' · '}
            <OutboundLink href={article.sourceHomepageUrl} />
          </>
        ) : null}
      </div>

      <ArticleJsonLd article={article} />
    </article>
  );
}

/**
 * Conservative schema.org JSON-LD. Only fields backed by real source data are
 * emitted — no fabricated authors, dates, or ratings. The serialized JSON has
 * `<` escaped so untrusted title/excerpt text can never break out of the script
 * element.
 */
function ArticleJsonLd({ article }: { readonly article: PublicArticleDetail }) {
  const datePublished = isoOrNull(article.publishedAt);
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    publisher: { '@type': 'Organization', name: article.sourceName },
    isBasedOn: safeExternalUrl(article.url) ?? undefined,
  };
  if (datePublished) data.datePublished = datePublished;
  if (article.author) data.author = { '@type': 'Person', name: article.author };
  // JSON-LD must be raw script text; jsonLdScriptContent escapes `<` so the
  // untrusted title/excerpt can never break out of the <script> element.
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(data) }}
    />
  );
}
