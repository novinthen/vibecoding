import type { Metadata } from 'next';
import Link from 'next/link';

import { getDb, isDatabaseConfigured } from '@/public/db';
import { getHomeData } from '@/public/content';
import { buildMetadata } from '@/public/metadata';
import { requireServedPublication } from '@/public/request';

import {
  ArticleList,
  DataUnavailable,
  SectionHeading,
  TopicNav,
} from './_components/ui';

// Reads request headers and live canonical data; always render fresh.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { config, baseUrl } = await requireServedPublication();
  return buildMetadata({ config, baseUrl, path: '/' });
}

export default async function HomePage() {
  const { config } = await requireServedPublication();

  if (!isDatabaseConfigured()) {
    return (
      <>
        <IntroHeader tagline={config.tagline} name={config.name} />
        <DataUnavailable />
      </>
    );
  }

  const { latest, primarySource, topics } = await getHomeData(getDb());

  return (
    <>
      <IntroHeader tagline={config.tagline} name={config.name} />
      <div className="grid gap-8 lg:grid-cols-[1fr_16rem]">
        <div>
          <SectionHeading title="Latest" href="/latest" />
          <ArticleList
            articles={latest}
            emptyLabel="No articles have been ingested yet. Once sources are polled, the newest coverage appears here."
          />
        </div>

        <aside className="flex flex-col gap-8">
          <div>
            <SectionHeading title="Primary sources" />
            {primarySource.length > 0 ? (
              <ul className="flex flex-col divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
                {primarySource.map((article) => (
                  <li key={article.id} className="py-2.5">
                    <Link
                      className="font-medium leading-snug hover:text-sky-700 dark:hover:text-sky-400"
                      href={`/article/${article.id}`}
                    >
                      {article.title}
                    </Link>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      {article.sourceName}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">
                No primary-source updates yet.
              </p>
            )}
          </div>

          <div>
            <SectionHeading
              title="Topics"
              href="/topic"
              linkLabel="All topics"
            />
            <TopicNav topics={topics} />
          </div>
        </aside>
      </div>
    </>
  );
}

function IntroHeader({
  name,
  tagline,
}: {
  readonly name: string;
  readonly tagline: string | null;
}) {
  return (
    <div className="mb-6 border-b border-neutral-200 pb-4 dark:border-neutral-800">
      <h1 className="text-xl font-bold tracking-tight">
        What&rsquo;s changing in AI-assisted software development
      </h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {tagline ??
          `${name} aggregates and links to original reporting on AI coding tools, agents, MCP, models, releases, and developer signals.`}
      </p>
    </div>
  );
}
