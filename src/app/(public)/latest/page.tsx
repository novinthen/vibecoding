import type { Metadata } from 'next';

import { getDb, isDatabaseConfigured } from '@/public/db';
import { getLatest, parsePage } from '@/public/content';
import { buildMetadata } from '@/public/metadata';
import { requireServedPublication } from '@/public/request';

import {
  ArticleList,
  DataUnavailable,
  PageHeading,
  Pagination,
} from '../_components/ui';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { config, baseUrl } = await requireServedPublication();
  return buildMetadata({
    config,
    baseUrl,
    path: '/latest',
    title: 'Latest',
    description: `The newest ingested coverage across ${config.name}, in chronological order with sources and timestamps.`,
  });
}

export default async function LatestPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  // Fail closed for an unresolved production host before rendering anything.
  await requireServedPublication();
  const page = parsePage((await searchParams).page);

  return (
    <>
      <PageHeading
        kicker="Chronological"
        title="Latest"
        description="Every publicly-visible article, newest first, with its source and publication time."
      />
      {!isDatabaseConfigured() ? (
        <DataUnavailable />
      ) : (
        <LatestList page={page} />
      )}
    </>
  );
}

async function LatestList({ page }: { readonly page: number }) {
  const { items, pagination } = await getLatest(getDb(), page);
  return (
    <>
      <ArticleList articles={items} />
      <Pagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        hasPrev={pagination.hasPrev}
        hasNext={pagination.hasNext}
        basePath="/latest"
      />
    </>
  );
}
