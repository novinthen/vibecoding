import type { Metadata } from 'next';

import { getToolPage, parsePage, type ToolPage } from '@/public/content';
import { getDb, isDatabaseConfigured } from '@/public/db';
import { buildMetadata } from '@/public/metadata';
import { getActivePublication } from '@/public/request';
import { notFound } from 'next/navigation';

import {
  ArticleList,
  OutboundLink,
  PageHeading,
  Pagination,
} from '../../_components/ui';

export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function load(slug: string, page: number): Promise<ToolPage | null> {
  if (!isDatabaseConfigured()) return null;
  return getToolPage(getDb(), slug, page);
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
      path: `/tool/${slug}`,
      title: 'Tool not found',
      index: false,
    });
  }
  return buildMetadata({
    config,
    baseUrl,
    path: `/tool/${data.entity.slug}`,
    title: data.entity.name,
    description:
      data.entity.description ??
      `Coverage and links related to ${data.entity.name}.`,
  });
}

export default async function ToolPageRoute({
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

  const { entity, items, pagination } = data;

  return (
    <>
      <PageHeading
        kicker={entity.entityType}
        title={entity.name}
        description={entity.description ?? undefined}
      />

      {entity.homepageUrl || entity.githubUrl ? (
        <div className="mb-6 flex flex-wrap gap-4 text-sm">
          {entity.homepageUrl ? (
            <span>
              Homepage: <OutboundLink href={entity.homepageUrl} />
            </span>
          ) : null}
          {entity.githubUrl ? (
            <span>
              GitHub: <OutboundLink href={entity.githubUrl} />
            </span>
          ) : null}
        </div>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
        Related coverage
      </h2>
      <ArticleList
        articles={items}
        emptyLabel="No linked coverage yet. Article associations are populated by later enrichment stages."
      />
      <Pagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        hasPrev={pagination.hasPrev}
        hasNext={pagination.hasNext}
        basePath={`/tool/${entity.slug}`}
      />
    </>
  );
}
