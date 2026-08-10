import type { ArticleClusteringView } from '@/admin/services/clustering-service';

import {
  AdminLink,
  Badge,
  Card,
  formatTimestamp,
} from '../../../_components/ui';
import { EmptyState } from '../../../_components/notices';

/**
 * Read-only clustering review for the Article detail page (Stage 7). Shows the
 * Story membership(s) this Article has and its full clustering decision history.
 * Internal intelligence only — never exposed on the public portal.
 */
export function ClusteringReview({
  view,
}: {
  readonly view: ArticleClusteringView;
}) {
  return (
    <Card title="Story clustering">
      {view.memberships.length === 0 ? (
        <EmptyState message="This Article is not attached to any Story." />
      ) : (
        <ul className="space-y-2">
          {view.memberships.map(({ story, membership }) => (
            <li
              key={story.id}
              className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <AdminLink href={`/admin/stories/${story.id}`}>
                  {story.canonical_title}
                </AdminLink>
                <Badge>{membership.relationship_type}</Badge>
                <Badge>{story.review_state}</Badge>
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {membership.decision_reason ?? '—'}
                {membership.score != null
                  ? ` · score ${membership.score.toFixed(3)}`
                  : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      {view.decisions.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Decision history
          </h3>
          <ul className="space-y-1 text-xs">
            {view.decisions.map((decision) => (
              <li
                key={decision.id}
                className="text-neutral-600 dark:text-neutral-400"
              >
                <span className="font-medium">{decision.decision}</span> ·{' '}
                {decision.decision_source} · {decision.method_version} ·{' '}
                {formatTimestamp(decision.created_at)}
                {decision.reason ? ` — ${decision.reason}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
