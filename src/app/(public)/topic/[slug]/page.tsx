import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getTopicPage, parsePage, type TopicPage } from '@/public/content';
import { getDb, isDatabaseConfigured } from '@/public/db';
import { buildMetadata } from '@/public/metadata';
import { getActivePublication } from '@/public/request';

import { ArticleList, PageHeading, Pagination } from '../../_components/ui';

export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function load(slug: string, page: number): Promise<TopicPage | null> {
  if (!isDatabaseConfigured()) return null;
  return getTopicPage(getDb(), slug, page);
}

export async function generateMetadata({
  params,
}: {
  readonly params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const { config, baseUrl } = await getActivePublication();
  const data = await load(slug, 1);
  if (!data) {
    return buildMetadata({
      config,
      baseUrl,
      path: `/topic/${slug}`,
      title: 'Topic not found',
      index: false,
    });
  }
  return buildMetadata({
    config,
    baseUrl,
    path: `/topic/${data.topic.slug}`,
    title: data.topic.name,
    description:
      data.topic.description ??
      `Vibe-coding coverage tagged ${data.topic.name}.`,
  });
}

export default async function TopicPageRoute({
  params,
  searchParams,
}: {
  readonly params: Params;
  readonly searchParams: SearchParams;
}) {
  const { slug } = await params;
  const page = parsePage((await searchParams).page);
  const data = await load(slug, page);
  if (!data) notFound();

  return (
    <>
      <PageHeading
        kicker="Topic"
        title={data.topic.name}
        description={data.topic.description ?? undefined}
      />
      <ArticleList
        articles={data.items}
        emptyLabel="No articles are associated with this topic yet."
      />
      <Pagination
        page={data.pagination.page}
        totalPages={data.pagination.totalPages}
        hasPrev={data.pagination.hasPrev}
        hasNext={data.pagination.hasNext}
        basePath={`/topic/${data.topic.slug}`}
      />
    </>
  );
}
