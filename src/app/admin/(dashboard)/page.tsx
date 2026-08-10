import { getOverview } from '@/admin/services/overview-service';

import {
  AdminLink,
  Card,
  FetchStatusBadge,
  formatTimestamp,
  HealthBadge,
  PageHeader,
  Stat,
} from '../_components/ui';
import { DatabaseUnavailable, EmptyState } from '../_components/notices';
import { getDb, isDatabaseConfigured } from '../_lib/db';

export default async function OverviewPage() {
  if (!isDatabaseConfigured()) {
    return (
      <>
        <PageHeader
          title="Overview"
          description="Operational status at a glance."
        />
        <DatabaseUnavailable />
      </>
    );
  }

  const overview = await getOverview(getDb());
  const { sourceHealth } = overview;
  const failing = sourceHealth.FAILING;
  const degraded = sourceHealth.DEGRADED;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Operational status at a glance."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Sources" value={overview.totalSources} />
        <Stat label="Healthy" value={sourceHealth.HEALTHY} tone="good" />
        <Stat
          label="Degraded"
          value={degraded}
          tone={degraded > 0 ? 'warn' : 'default'}
        />
        <Stat
          label="Failing"
          value={failing}
          tone={failing > 0 ? 'bad' : 'default'}
        />
        <Stat label="Disabled" value={sourceHealth.DISABLED} />
        <Stat label="Articles" value={overview.totalArticles} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sources needing attention">
          {overview.attentionSources.length === 0 ? (
            <EmptyState message="All enabled Sources are healthy." />
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {overview.attentionSources.map((source) => (
                <li
                  key={source.id}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <AdminLink href={`/admin/sources/${source.id}`}>
                    {source.name}
                  </AdminLink>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-500">
                      {source.failure_count} fail
                    </span>
                    <HealthBadge status={source.health_status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent failures">
          {overview.recentFailures.length === 0 ? (
            <EmptyState message="No recent fetch failures." />
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {overview.recentFailures.map((fetch) => (
                <li key={fetch.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <AdminLink href={`/admin/sources/${fetch.source_id}`}>
                      {fetch.source_name}
                    </AdminLink>
                    <span className="text-xs text-neutral-500">
                      {formatTimestamp(fetch.started_at)}
                    </span>
                  </div>
                  {fetch.error_code ? (
                    <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                      {fetch.error_code}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent fetches">
          {overview.recentFetches.length === 0 ? (
            <EmptyState message="No fetches recorded yet." />
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {overview.recentFetches.map((fetch) => (
                <li
                  key={fetch.id}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <AdminLink href={`/admin/sources/${fetch.source_id}`}>
                    {fetch.source_name}
                  </AdminLink>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-500">
                      new {fetch.items_new ?? 0}
                    </span>
                    <FetchStatusBadge status={fetch.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recently ingested Articles">
          {overview.recentArticles.length === 0 ? (
            <EmptyState message="No Articles ingested yet." />
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {overview.recentArticles.map((article) => (
                <li key={article.id} className="py-2 text-sm">
                  <AdminLink href={`/admin/articles/${article.id}`}>
                    {article.original_title}
                  </AdminLink>
                  <div className="mt-0.5 text-xs text-neutral-500">
                    {formatTimestamp(article.discovered_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
