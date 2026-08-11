import { notFound } from 'next/navigation';

import {
  AdminAuditLogRepository,
  ArticleRepository,
  SourceFetchRepository,
  SourceRepository,
  TopicRepository,
} from '@/domain';

import {
  AdminLink,
  Badge,
  buttonClass,
  Card,
  FetchStatusBadge,
  formatTimestamp,
  HealthBadge,
  PageHeader,
  secondaryButtonClass,
} from '../../../_components/ui';
import { DatabaseUnavailable, EmptyState } from '../../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../../_lib/db';
import {
  setSourceEnabledAction,
  triggerIngestionAction,
  updateSourceAction,
} from '../actions';
import { SourceForm } from '../source-form';

export default async function SourceDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!isDatabaseConfigured()) {
    return (
      <>
        <PageHeader title="Source" />
        <DatabaseUnavailable />
      </>
    );
  }

  const db = getDb();
  const source = await new SourceRepository(db).findById(id);
  if (!source) notFound();

  const [topics, fetches, articles, audit] = await Promise.all([
    new TopicRepository(db).listAll(),
    new SourceFetchRepository(db).listRecent(id, 15),
    new ArticleRepository(db).listBySource(id, 10),
    new AdminAuditLogRepository(db).listRecent({
      targetType: 'source',
      targetId: id,
      limit: 10,
    }),
  ]);

  return (
    <>
      <PageHeader
        title={source.name}
        description={source.slug}
        action={<HealthBadge status={source.health_status} />}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Operational state">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-neutral-500">Enabled</dt>
            <dd>{source.enabled ? 'Yes' : 'No'}</dd>
            <dt className="text-neutral-500">Consecutive failures</dt>
            <dd>{source.failure_count}</dd>
            <dt className="text-neutral-500">Last fetch</dt>
            <dd>{formatTimestamp(source.last_fetch_at)}</dd>
            <dt className="text-neutral-500">Last success</dt>
            <dd>{formatTimestamp(source.last_success_at)}</dd>
            <dt className="text-neutral-500">Conditional (ETag)</dt>
            <dd>{source.etag ? 'stored' : '—'}</dd>
            <dt className="text-neutral-500">Conditional (Last-Modified)</dt>
            <dd>{source.last_modified ? 'stored' : '—'}</dd>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <form action={triggerIngestionAction}>
              <input type="hidden" name="id" value={source.id} />
              <button type="submit" className={buttonClass}>
                Run ingestion now
              </button>
            </form>
            <form action={setSourceEnabledAction}>
              <input type="hidden" name="id" value={source.id} />
              <input
                type="hidden"
                name="enabled"
                value={source.enabled ? 'false' : 'true'}
              />
              <button type="submit" className={secondaryButtonClass}>
                {source.enabled ? 'Disable' : 'Enable'}
              </button>
            </form>
          </div>
        </Card>

        <Card title="Configuration">
          <SourceForm
            action={updateSourceAction.bind(null, source.id)}
            mode="edit"
            topics={topics.map((topic) => ({ id: topic.id, name: topic.name }))}
            initial={{
              name: source.name,
              slug: source.slug,
              sourceType: source.source_type,
              authorityTier: source.authority_tier,
              homepageUrl: source.homepage_url ?? '',
              feedUrl: source.feed_url ?? '',
              language: source.language ?? '',
              pollInterval:
                source.poll_interval === null
                  ? ''
                  : String(source.poll_interval),
              defaultTopicId: source.default_topic_id ?? '',
              sourceConfig:
                source.source_config &&
                Object.keys(source.source_config).length > 0
                  ? JSON.stringify(source.source_config, null, 2)
                  : '',
            }}
            submitLabel="Save changes"
          />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Recent fetches">
          {fetches.length === 0 ? (
            <EmptyState message="No fetch attempts recorded." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-neutral-500">
                  <tr className="border-b border-neutral-200 dark:border-neutral-800">
                    <th className="py-2 pr-3">Started</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">HTTP</th>
                    <th className="py-2 pr-3">Found</th>
                    <th className="py-2 pr-3">New</th>
                    <th className="py-2 pr-3">ms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {fetches.map((fetch) => (
                    <tr key={fetch.id}>
                      <td className="py-2 pr-3 text-neutral-500">
                        {formatTimestamp(fetch.started_at)}
                      </td>
                      <td className="py-2 pr-3">
                        <FetchStatusBadge status={fetch.status} />
                        {fetch.error_code ? (
                          <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                            {fetch.error_code}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{fetch.http_status ?? '—'}</td>
                      <td className="py-2 pr-3">{fetch.items_found ?? '—'}</td>
                      <td className="py-2 pr-3">{fetch.items_new ?? '—'}</td>
                      <td className="py-2 pr-3">{fetch.duration_ms ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Recent Articles">
          {articles.length === 0 ? (
            <EmptyState message="No Articles ingested from this Source yet." />
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {articles.map((article) => (
                <li key={article.id} className="py-2 text-sm">
                  <AdminLink href={`/admin/articles/${article.id}`}>
                    {article.original_title}
                  </AdminLink>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
                    <Badge>{article.status}</Badge>
                    <span>{formatTimestamp(article.published_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Audit trail">
          {audit.length === 0 ? (
            <EmptyState message="No admin actions recorded for this Source." />
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {audit.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium">{entry.action}</span>
                    <span className="ml-2 text-neutral-500">
                      by {entry.actor_identifier ?? 'unknown'}
                    </span>
                  </div>
                  <span className="text-xs text-neutral-500">
                    {formatTimestamp(entry.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
