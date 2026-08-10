import type { Metadata } from 'next';
import Link from 'next/link';

import { getTopicIndex } from '@/public/content';
import { getDb, isDatabaseConfigured } from '@/public/db';
import { buildMetadata } from '@/public/metadata';
import { requireServedPublication } from '@/public/request';

import { DataUnavailable, EmptyState, PageHeading } from '../_components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { config, baseUrl } = await requireServedPublication();
  return buildMetadata({
    config,
    baseUrl,
    path: '/topic',
    title: 'Topics',
    description:
      'Browse vibe-coding coverage by topic: tools, coding agents, models, MCP, open source, and more.',
  });
}

export default async function TopicIndexPage() {
  await requireServedPublication();
  return (
    <>
      <PageHeading
        kicker="Browse"
        title="Topics"
        description="The controlled taxonomy for the vibe-coding ecosystem. Counts reflect currently visible articles."
      />
      {!isDatabaseConfigured() ? <DataUnavailable /> : <TopicGrid />}
    </>
  );
}

async function TopicGrid() {
  const topics = await getTopicIndex(getDb());
  if (topics.length === 0) {
    return <EmptyState>No topics are configured yet.</EmptyState>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {topics.map((topic) => (
        <Link
          key={topic.id}
          href={`/topic/${topic.slug}`}
          className="rounded-lg border border-neutral-200 p-4 transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold">{topic.name}</span>
            <span className="text-xs text-neutral-400">
              {topic.articleCount}
            </span>
          </div>
          {topic.description ? (
            <p className="mt-1 text-sm text-neutral-500">{topic.description}</p>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
