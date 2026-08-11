import type { Metadata } from 'next';

import { getDb, isDatabaseConfigured } from '@/public/db';
import { buildMetadata } from '@/public/metadata';
import { requireServedPublication } from '@/public/request';
import { listPublishedStoriesRanked } from '@/ranking/public-ranking-queries';

import { DataUnavailable } from '../_components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { config, baseUrl } = await requireServedPublication();
  return buildMetadata({
    config,
    baseUrl,
    path: '/top',
    title: 'Top Stories',
    description: 'The most important stories right now.',
  });
}

export default async function TopStoriesPage() {
  const servedPub = await requireServedPublication();

  if (!isDatabaseConfigured()) {
    return (
      <>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Top Stories</h1>
        </div>
        <DataUnavailable />
      </>
    );
  }

  const db = getDb();
  const publicationId =
    servedPub.status === 'database' ? servedPub.config.id : null;

  if (!publicationId) {
    return (
      <>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Top Stories</h1>
        </div>
        <p className="text-neutral-500">No publication configured.</p>
      </>
    );
  }

  const stories = await listPublishedStoriesRanked(db, publicationId, 50);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Top Stories</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          The most important stories right now.
        </p>
      </div>
      <div className="space-y-6">
        {stories.length > 0 ? (
          <ul className="space-y-4">
            {stories.map((story, idx) => (
              <li
                key={story.id}
                className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex gap-3">
                  <div className="flex-shrink-0 text-2xl font-bold text-neutral-400">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold">
                      <a
                        href={`/story/${story.publication_slug || story.slug}`}
                        className="hover:text-sky-600"
                      >
                        {story.publication_headline || story.canonical_title}
                      </a>
                    </h2>
                    {(story.publication_summary || story.summary) && (
                      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                        {story.publication_summary || story.summary}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
                      {story.featured && (
                        <span className="rounded bg-sky-100 px-2 py-0.5 font-medium text-sky-700 dark:bg-sky-900 dark:text-sky-300">
                          Featured
                        </span>
                      )}
                      {story.published_at && (
                        <span>
                          {new Date(story.published_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-neutral-500">No top stories available yet.</p>
        )}
      </div>
    </>
  );
}
