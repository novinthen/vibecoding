import { notFound } from 'next/navigation';

import { getStoryClusteringView } from '@/admin/services/clustering-service';
import { AdminRankingService } from '@/admin/ranking-admin-service';
import { AdminAuditLogRepository } from '@/domain';
import type { ClusteringDecisionRow } from '@/domain/types';

import {
  AdminLink,
  Badge,
  Card,
  formatTimestamp,
  PageHeader,
  Stat,
} from '../../../_components/ui';
import { DatabaseUnavailable, EmptyState } from '../../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../../_lib/db';

import {
  DetachButton,
  MoveArticleForm,
  ReviewStateForm,
} from './story-actions';
import { TriggerRankingButton } from './ranking-card';

export default async function StoryDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isDatabaseConfigured()) {
    return (
      <>
        <PageHeader title="Story" />
        <DatabaseUnavailable />
      </>
    );
  }

  const db = getDb();
  const view = await getStoryClusteringView(db, id);
  if (!view) notFound();
  const { story, members, decisions, sourceCount } = view;

  // Fetch ranking information
  const rankingService = new AdminRankingService(db);
  const currentRanking = await rankingService.getCurrentRanking(id, null);
  const rankingHistory = await rankingService.getRankingHistory(id, null, 5);

  const audit = await new AdminAuditLogRepository(db).listRecent({
    targetType: 'story',
    targetId: id,
    limit: 10,
  });

  return (
    <>
      <PageHeader
        title="Story"
        description="Canonical clustering of Article evidence — never published automatically."
        action={
          <>
            <Badge>{story.status}</Badge>
            <Badge>{story.review_state}</Badge>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Articles" value={members.length} />
        <Stat label="Source diversity" value={sourceCount} />
        <Stat label="Formation" value={story.formation_source} />
        <Stat label="Method" value={story.clustering_version ?? '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Canonical (provisional) facts">
            {/* Untrusted-derived title: escaped by React. Provisional until reviewed. */}
            <h2 className="text-lg font-semibold">{story.canonical_title}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Meta label="Slug" value={story.slug} mono />
              <Meta
                label="Primary Article"
                value={story.primary_article_id}
                mono
              />
              <Meta label="Formed" value={formatTimestamp(story.created_at)} />
              <Meta
                label="Last activity"
                value={formatTimestamp(story.last_activity_at)}
              />
            </dl>
          </Card>

          <Card title="Attached Articles (evidence)">
            {members.length === 0 ? (
              <EmptyState message="No Articles attached." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-neutral-500">
                    <tr className="border-b border-neutral-200 dark:border-neutral-800">
                      <th className="py-2 pr-3">Article</th>
                      <th className="py-2 pr-3">Source</th>
                      <th className="py-2 pr-3">Role</th>
                      <th className="py-2 pr-3">Score</th>
                      <th className="py-2 pr-3">Origin</th>
                      <th className="py-2 pr-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {members.map((m) => (
                      <tr key={m.article.id}>
                        <td className="py-2 pr-3">
                          <AdminLink href={`/admin/articles/${m.article.id}`}>
                            {m.article.original_title}
                          </AdminLink>
                          <div className="text-xs text-neutral-500">
                            {m.membership.decision_reason ?? '—'}
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-neutral-500">
                          {m.article.source_name ?? '—'}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge>{m.membership.relationship_type}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-neutral-500">
                          {m.membership.score != null
                            ? m.membership.score.toFixed(3)
                            : '—'}
                        </td>
                        <td className="py-2 pr-3 text-neutral-500">
                          {m.membership.assignment_source ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <DetachButton
                            storyId={story.id}
                            articleId={m.article.id}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Clustering decisions (provenance)">
            {decisions.length === 0 ? (
              <EmptyState message="No clustering decisions recorded." />
            ) : (
              <ul className="space-y-3">
                {decisions.map((decision) => (
                  <DecisionItem key={decision.id} decision={decision} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Ranking">
            {currentRanking ? (
              <div className="space-y-3">
                <div>
                  <div className="text-2xl font-bold">
                    {currentRanking.calculated_score.toFixed(3)}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {currentRanking.ranking_method}/{currentRanking.ranking_version} ·{' '}
                    {formatTimestamp(currentRanking.calculated_at)}
                  </div>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Freshness</span>
                    <span className="font-mono">{currentRanking.signals.freshness.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Source Diversity</span>
                    <span className="font-mono">{currentRanking.signals.sourceDiversity.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Source Authority</span>
                    <span className="font-mono">{currentRanking.signals.sourceAuthority.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Story Activity</span>
                    <span className="font-mono">{currentRanking.signals.storyActivity.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Novelty</span>
                    <span className="font-mono">{currentRanking.signals.novelty.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">AI Importance</span>
                    <span className="font-mono">
                      {currentRanking.signals.aiImportance != null
                        ? currentRanking.signals.aiImportance.toFixed(2)
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-neutral-200 pt-1 dark:border-neutral-800">
                    <span className="text-neutral-500">Editorial Adj.</span>
                    <span className="font-mono">
                      {currentRanking.signals.editorialAdjustment >= 0 ? '+' : ''}
                      {currentRanking.signals.editorialAdjustment.toFixed(2)}
                    </span>
                  </div>
                </div>

                {rankingHistory.length > 1 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-neutral-500">
                      {rankingHistory.length} version(s)
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {rankingHistory.slice(1).map((r) => (
                        <li
                          key={r.id}
                          className="rounded bg-neutral-50 px-2 py-1 font-mono text-xs dark:bg-neutral-950"
                        >
                          {r.calculated_score.toFixed(3)} ·{' '}
                          {formatTimestamp(r.calculated_at)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <TriggerRankingButton storyId={story.id} />
              </div>
            ) : (
              <div className="space-y-3">
                <EmptyState message="No ranking calculated yet." />
                <TriggerRankingButton storyId={story.id} />
              </div>
            )}
          </Card>

          <Card title="Review state">
            <ReviewStateForm storyId={story.id} current={story.review_state} />
          </Card>

          <Card title="Move an Article">
            {members.length === 0 ? (
              <EmptyState message="No Articles to move." />
            ) : (
              <MoveArticleForm
                storyId={story.id}
                members={members.map((m) => ({
                  id: m.article.id,
                  title: m.article.original_title,
                }))}
              />
            )}
          </Card>

          <Card title="Audit trail">
            {audit.length === 0 ? (
              <EmptyState message="No admin actions recorded." />
            ) : (
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {audit.map((entry) => (
                  <li key={entry.id} className="py-2 text-sm">
                    <div className="font-medium">{entry.action}</div>
                    <div className="text-xs text-neutral-500">
                      {entry.actor_identifier ?? 'unknown'} ·{' '}
                      {formatTimestamp(entry.created_at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function DecisionItem({
  decision,
}: {
  readonly decision: ClusteringDecisionRow;
}) {
  return (
    <li className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{decision.decision}</Badge>
        <Badge>{decision.decision_source}</Badge>
        <span className="text-xs text-neutral-500">
          {decision.method}/{decision.method_version} ·{' '}
          {formatTimestamp(decision.created_at)}
        </span>
      </div>
      {decision.reason ? (
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          {decision.reason}
        </p>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-neutral-500 sm:grid-cols-4">
        <span>top score: {fmt(decision.top_score)}</span>
        <span>confidence: {fmt(decision.confidence)}</span>
        <span>candidates: {decision.candidate_count}</span>
        <span>embedding: {decision.embedding_model ?? '—'}</span>
      </div>
      {decision.candidates.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-neutral-500">
            {decision.candidates.length} scored candidate(s)
          </summary>
          <ul className="mt-1 space-y-1">
            {decision.candidates.map((candidate) => (
              <li
                key={candidate.storyId}
                className="rounded bg-neutral-50 px-2 py-1 font-mono text-xs dark:bg-neutral-950"
              >
                {candidate.storyId.slice(0, 8)} · score{' '}
                {candidate.score.toFixed(3)} · emb{' '}
                {fmt(candidate.signals.embedding)} · title{' '}
                {fmt(candidate.signals.title)} ·{' '}
                {candidate.passesThreshold ? 'passes' : 'below'} ·{' '}
                {candidate.sources.join('+')}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function fmt(value: number | null | undefined): string {
  return value == null ? '—' : value.toFixed(3);
}

function Meta({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className={`break-all ${mono ? 'font-mono text-xs' : ''}`}>
        {value ?? '—'}
      </dd>
    </div>
  );
}
