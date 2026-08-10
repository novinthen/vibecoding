import Link from 'next/link';
import type { ReactNode } from 'react';

import { safeExternalUrl, displayHost } from '@/lib/safe-url';
import type { AuthorityTier } from '@/domain/enums';
import {
  clampExcerpt,
  formatRelative,
  formatUtc,
  isoOrNull,
} from '@/public/format';
import type {
  PublicArticleListItem,
  PublicTopicWithCount,
} from '@/public/types';

/**
 * Presentational building blocks for the public portal.
 *
 * Restrained, high-density news UI (no marketing hero, no gradients). All are
 * server-safe (no client hooks). Untrusted, feed-derived text is always rendered
 * as escaped React children — never `dangerouslySetInnerHTML` — and untrusted
 * URLs pass through `safeExternalUrl` before ever becoming an href.
 */

export function PageHeading({
  title,
  description,
  kicker,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly kicker?: string;
}) {
  return (
    <div className="mb-6">
      {kicker ? (
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-700 dark:text-sky-400">
          {kicker}
        </p>
      ) : null}
      <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
        {title}
      </h1>
      {description ? (
        <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  readonly title: string;
  readonly href?: string;
  readonly linkLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between border-b border-neutral-200 pb-2 dark:border-neutral-800">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
        {title}
      </h2>
      {href ? (
        <Link
          href={href}
          className="text-xs font-medium text-sky-700 hover:underline dark:text-sky-400"
        >
          {linkLabel ?? 'View all'}
        </Link>
      ) : null}
    </div>
  );
}

const AUTHORITY_TONE: Record<AuthorityTier, string> = {
  PRIMARY:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  TRUSTED: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  SPECIALIST:
    'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  COMMUNITY:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  DISCOVERY:
    'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

export function AuthorityBadge({ tier }: { readonly tier: AuthorityTier }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${AUTHORITY_TONE[tier]}`}
      title={`${tier} source`}
    >
      {tier}
    </span>
  );
}

/**
 * Render an untrusted, feed-derived outbound URL. A safe http(s) value becomes a
 * rel-hardened new-tab link; anything else is inert escaped text. Provenance and
 * outbound access to original reporting are core product requirements.
 */
export function OutboundLink({
  href,
  children,
  className,
}: {
  readonly href: string | null;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  const safe = safeExternalUrl(href);
  const label = children ?? displayHost(href) ?? href ?? '—';
  if (!safe) {
    return <span className={className}>{label}</span>;
  }
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={
        className ??
        'font-medium text-sky-700 hover:underline dark:text-sky-400'
      }
    >
      {label}
    </a>
  );
}

/**
 * A timestamp. Shows a relative age with the absolute UTC value as the title and
 * a machine-readable `dateTime`. When the publish time is unknown, it honestly
 * labels the ingestion time instead of inventing a publication date.
 */
export function TimeStamp({
  publishedAt,
  discoveredAt,
}: {
  readonly publishedAt: string | null;
  readonly discoveredAt?: string | null;
}) {
  const value = publishedAt ?? discoveredAt ?? null;
  const iso = isoOrNull(value);
  const relative = formatRelative(value);
  const absolute = formatUtc(value);
  if (!iso || !relative) return null;
  const prefix = publishedAt ? '' : 'ingested ';
  return (
    <time
      dateTime={iso}
      title={absolute ?? undefined}
      className="whitespace-nowrap"
    >
      {prefix}
      {relative}
    </time>
  );
}

/** One Article row in a list: title → detail, source, topic, time, excerpt. */
export function ArticleRow({
  article,
}: {
  readonly article: PublicArticleListItem;
}) {
  const excerpt = clampExcerpt(article.excerpt);
  return (
    <article className="py-4">
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
        <span aria-hidden>·</span>
        <TimeStamp
          publishedAt={article.publishedAt}
          discoveredAt={article.discoveredAt}
        />
      </div>
      <h3 className="mt-1.5 text-base font-semibold leading-snug">
        <Link
          href={`/article/${article.id}`}
          className="hover:text-sky-700 dark:hover:text-sky-400"
        >
          {article.title}
        </Link>
      </h3>
      {excerpt ? (
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {excerpt}
        </p>
      ) : null}
      <div className="mt-1.5 text-xs">
        <OutboundLink href={article.url}>
          Read at {displayHost(article.url) ?? article.sourceName} →
        </OutboundLink>
      </div>
    </article>
  );
}

/** A divided list of Article rows, or an honest empty state. */
export function ArticleList({
  articles,
  emptyLabel = 'No articles to show yet.',
}: {
  readonly articles: readonly PublicArticleListItem[];
  readonly emptyLabel?: string;
}) {
  if (articles.length === 0) {
    return <EmptyState>{emptyLabel}</EmptyState>;
  }
  return (
    <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
      {articles.map((article) => (
        <ArticleRow key={article.id} article={article} />
      ))}
    </div>
  );
}

export function TopicNav({
  topics,
}: {
  readonly topics: readonly PublicTopicWithCount[];
}) {
  if (topics.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {topics.map((topic) => (
        <li key={topic.id}>
          <Link
            href={`/topic/${topic.slug}`}
            className="flex items-center justify-between rounded px-2 py-1 text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <span>{topic.name}</span>
            <span className="text-xs text-neutral-400">
              {topic.articleCount}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ children }: { readonly children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
      {children}
    </div>
  );
}

/**
 * Honest state for when no database is configured for the deployment. Public
 * rendering degrades to a clear message rather than crashing or faking content.
 */
export function DataUnavailable() {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center dark:border-neutral-700">
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
        Content is not available right now.
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        This deployment has no data source configured yet.
      </p>
    </div>
  );
}

/** Prev/next pagination that preserves an optional base query string. */
export function Pagination({
  page,
  totalPages,
  hasPrev,
  hasNext,
  basePath,
  extraQuery,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
  readonly basePath: string;
  readonly extraQuery?: Record<string, string>;
}) {
  if (totalPages <= 1) return null;
  const href = (targetPage: number): string => {
    const params = new URLSearchParams(extraQuery);
    if (targetPage > 1) params.set('page', String(targetPage));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <nav className="mt-6 flex items-center justify-between border-t border-neutral-200 pt-4 text-sm dark:border-neutral-800">
      {hasPrev ? (
        <Link href={href(page - 1)} className={paginationLinkClass} rel="prev">
          ← Newer
        </Link>
      ) : (
        <span className={paginationDisabledClass}>← Newer</span>
      )}
      <span className="text-xs text-neutral-500">
        Page {page} of {totalPages}
      </span>
      {hasNext ? (
        <Link href={href(page + 1)} className={paginationLinkClass} rel="next">
          Older →
        </Link>
      ) : (
        <span className={paginationDisabledClass}>Older →</span>
      )}
    </nav>
  );
}

const paginationLinkClass =
  'rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800';
const paginationDisabledClass =
  'rounded-md border border-neutral-200 px-3 py-1.5 font-medium text-neutral-300 dark:border-neutral-800 dark:text-neutral-600';
