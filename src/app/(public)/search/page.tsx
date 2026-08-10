import type { Metadata } from 'next';

import { parsePage, search } from '@/public/content';
import { getDb, isDatabaseConfigured } from '@/public/db';
import { buildMetadata } from '@/public/metadata';
import { requireServedPublication } from '@/public/request';

import {
  ArticleList,
  DataUnavailable,
  EmptyState,
  PageHeading,
  Pagination,
} from '../_components/ui';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v ?? '';
}

export async function generateMetadata(): Promise<Metadata> {
  const { config, baseUrl } = await requireServedPublication();
  // Search-result pages carry no durable content; keep them out of the index.
  return buildMetadata({
    config,
    baseUrl,
    path: '/search',
    title: 'Search',
    description: 'Search articles across the portal.',
    index: false,
  });
}

export default async function SearchPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  await requireServedPublication();
  const resolved = await searchParams;
  const query = firstParam(resolved.q).trim();
  const page = parsePage(resolved.page);

  return (
    <>
      <PageHeading kicker="Search" title="Search" />

      <form action="/search" method="get" role="search" className="mb-6">
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search articles by title or excerpt…"
            aria-label="Search query"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            Search
          </button>
        </div>
      </form>

      {!isDatabaseConfigured() ? (
        <DataUnavailable />
      ) : query === '' ? (
        <EmptyState>
          Enter a query to search across ingested articles.
        </EmptyState>
      ) : (
        <SearchResults query={query} page={page} />
      )}
    </>
  );
}

async function SearchResults({
  query,
  page,
}: {
  readonly query: string;
  readonly page: number;
}) {
  const result = await search(getDb(), query, page);
  return (
    <>
      <p className="mb-3 text-sm text-neutral-500">
        {result.pagination.total} result
        {result.pagination.total === 1 ? '' : 's'} for{' '}
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {query}
        </span>
      </p>
      <ArticleList
        articles={result.items}
        emptyLabel="No articles match your search."
      />
      <Pagination
        page={result.pagination.page}
        totalPages={result.pagination.totalPages}
        hasPrev={result.pagination.hasPrev}
        hasNext={result.pagination.hasNext}
        basePath="/search"
        extraQuery={{ q: query }}
      />
    </>
  );
}
