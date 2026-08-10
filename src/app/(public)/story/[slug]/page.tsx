import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getStoryPage, type StoryPage } from '@/public/content';
import { getDb, isDatabaseConfigured } from '@/public/db';
import { clampExcerpt, formatUtc } from '@/public/format';
import { buildMetadata } from '@/public/metadata';
import { getActivePublication } from '@/public/request';

import { ArticleList, PageHeading } from '../../_components/ui';

/**
 * Public Story route.
 *
 * The data model already contains Story, but Story clustering/intelligence is a
 * later stage (6/7) and no Stories are published yet. Rather than fabricate
 * Story records, this route is the honest architectural seam: it resolves a Story
 * only when a real PublicationStory (PUBLISHED) exists for the active
 * Publication, and 404s otherwise. Content is drawn from real editorial/canonical
 * fields — never AI-invented prose.
 */
export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;

async function load(
  publicationId: string | null,
  slug: string,
): Promise<StoryPage | null> {
  if (!isDatabaseConfigured()) return null;
  return getStoryPage(getDb(), publicationId, slug);
}

export async function generateMetadata({
  params,
}: {
  readonly params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const { config, baseUrl } = await getActivePublication();
  const data = await load(config.id, slug);
  if (!data) {
    return buildMetadata({
      config,
      baseUrl,
      path: `/story/${slug}`,
      title: 'Story not found',
      index: false,
    });
  }
  return buildMetadata({
    config,
    baseUrl,
    path: `/story/${data.story.slug}`,
    title: data.story.title,
    description:
      clampExcerpt(data.story.summary, 200) ??
      `A developing story on ${config.name}.`,
    ogType: 'article',
  });
}

export default async function StoryPageRoute({
  params,
}: {
  readonly params: Params;
}) {
  const { slug } = await params;
  const { config } = await getActivePublication();
  const data = await load(config.id, slug);
  if (!data) notFound();

  const { story, articles } = data;
  const published = formatUtc(story.publishedAt ?? story.lastActivityAt);

  return (
    <article className="mx-auto max-w-3xl">
      <PageHeading
        kicker="Story"
        title={story.title}
        description={
          story.topicName && story.topicSlug ? (
            <Link
              href={`/topic/${story.topicSlug}`}
              className="hover:underline"
            >
              {story.topicName}
            </Link>
          ) : undefined
        }
      />
      {published ? (
        <p className="-mt-3 mb-4 text-sm text-neutral-500">{published}</p>
      ) : null}

      {story.summary ? (
        <p className="text-[0.95rem] leading-relaxed text-neutral-800 dark:text-neutral-200">
          {story.summary}
        </p>
      ) : null}

      {story.whyItMatters ? (
        <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Why it matters
          </h2>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            {story.whyItMatters}
          </p>
        </div>
      ) : null}

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
        Coverage
      </h2>
      <ArticleList
        articles={articles}
        emptyLabel="No source articles are linked to this story yet."
      />
    </article>
  );
}
