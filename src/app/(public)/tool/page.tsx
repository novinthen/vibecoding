import type { Metadata } from 'next';
import Link from 'next/link';

import { getToolIndex } from '@/public/content';
import { getDb, isDatabaseConfigured } from '@/public/db';
import { buildMetadata } from '@/public/metadata';
import { getActivePublication } from '@/public/request';

import { DataUnavailable, EmptyState, PageHeading } from '../_components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { config, baseUrl } = await getActivePublication();
  return buildMetadata({
    config,
    baseUrl,
    path: '/tool',
    title: 'Tools',
    description:
      'Tools, products, models, and repositories tracked across the vibe-coding ecosystem.',
  });
}

export default async function ToolIndexPage() {
  return (
    <>
      <PageHeading
        kicker="Ecosystem"
        title="Tools"
        description="Entities — tools, products, models, protocols, and repositories — tracked across the ecosystem. This catalogue grows as coverage is enriched."
      />
      {!isDatabaseConfigured() ? <DataUnavailable /> : <ToolGrid />}
    </>
  );
}

async function ToolGrid() {
  const entities = await getToolIndex(getDb());
  if (entities.length === 0) {
    return (
      <EmptyState>
        No tools are catalogued yet. Tool profiles are populated as the
        knowledge base is enriched in later stages.
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entities.map((entity) => (
        <Link
          key={entity.id}
          href={`/tool/${entity.slug}`}
          className="rounded-lg border border-neutral-200 p-4 transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            {entity.entityType}
          </div>
          <div className="mt-0.5 font-semibold">{entity.name}</div>
          {entity.description ? (
            <p className="mt-1 line-clamp-3 text-sm text-neutral-500">
              {entity.description}
            </p>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
