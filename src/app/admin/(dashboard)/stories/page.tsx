import { StoryRepository } from '@/domain';

import {
  AdminLink,
  Badge,
  Card,
  formatTimestamp,
  PageHeader,
} from '../../_components/ui';
import { DatabaseUnavailable, EmptyState } from '../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../_lib/db';

const REVIEW_TONE: Record<string, string> = {
  UNREVIEWED:
    'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
  REVIEWED:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  LOCKED:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};

/**
 * Clustering review — canonical Stories formed by the clustering engine. This is
 * an internal intelligence surface: Stories here are NOT public until an editor
 * publishes them via a Publication (PublicationStory). No clustering scores or
 * review states are ever exposed publicly.
 */
export default async function StoriesPage() {
  if (!isDatabaseConfigured()) {
    return (
      <>
        <PageHeader title="Stories" />
        <DatabaseUnavailable />
      </>
    );
  }

  const stories = await new StoryRepository(getDb()).listRecentWithStats(100);

  return (
    <>
      <PageHeader
        title="Stories"
        description="Canonical clustering of Article evidence. Internal until published."
      />
      <Card>
        {stories.length === 0 ? (
          <EmptyState message="No Stories yet. Run clustering from an Article to form one." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-neutral-500">
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="py-2 pr-3">Title</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Review</th>
                  <th className="py-2 pr-3">Articles</th>
                  <th className="py-2 pr-3">Sources</th>
                  <th className="py-2 pr-3">Formed</th>
                  <th className="py-2 pr-3">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {stories.map((story) => (
                  <tr key={story.id}>
                    <td className="py-2 pr-3">
                      {/* Untrusted-derived title: escaped by React. */}
                      <AdminLink href={`/admin/stories/${story.id}`}>
                        {story.canonical_title}
                      </AdminLink>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge>{story.status}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge className={REVIEW_TONE[story.review_state]}>
                        {story.review_state}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">{story.article_count}</td>
                    <td className="py-2 pr-3">{story.source_count}</td>
                    <td className="py-2 pr-3 text-neutral-500">
                      {story.formation_source}
                    </td>
                    <td className="py-2 pr-3 text-neutral-500">
                      {formatTimestamp(story.last_activity_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
