import { notFound } from 'next/navigation';

import {
  AdminAuditLogRepository,
  ArticleRepository,
  SourceRepository,
} from '@/domain';

import {
  AdminLink,
  Badge,
  Card,
  formatTimestamp,
  PageHeader,
} from '../../../_components/ui';
import { DatabaseUnavailable, EmptyState } from '../../../_components/notices';
import { ExternalUrl } from '../../../_components/untrusted';
import { getDb, isDatabaseConfigured } from '../../../_lib/db';
import { ArticleStatusForm } from '../status-form';

export default async function ArticleDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!isDatabaseConfigured()) {
    return (
      <>
        <PageHeader title="Article" />
        <DatabaseUnavailable />
      </>
    );
  }

  const db = getDb();
  const article = await new ArticleRepository(db).findById(id);
  if (!article) notFound();

  const [source, audit] = await Promise.all([
    new SourceRepository(db).findById(article.source_id),
    new AdminAuditLogRepository(db).listRecent({
      targetType: 'article',
      targetId: id,
      limit: 10,
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Article"
        description="Inspection only — source facts are read-only."
        action={<Badge>{article.status}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Source facts">
            {/* Untrusted feed content: rendered as escaped text by React. */}
            <h2 className="text-lg font-semibold">{article.original_title}</h2>
            {article.original_excerpt ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">
                {article.original_excerpt}
              </p>
            ) : null}

            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-neutral-500">Source</dt>
                <dd>
                  {source ? (
                    <AdminLink href={`/admin/sources/${source.id}`}>
                      {source.name}
                    </AdminLink>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Original / source URL</dt>
                <dd>
                  <ExternalUrl value={article.url} />
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Canonical URL</dt>
                <dd>
                  <ExternalUrl value={article.canonical_url} />
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-neutral-500">Author</dt>
                  <dd>{article.author ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Language</dt>
                  <dd>{article.language ?? '—'}</dd>
                </div>
              </div>
            </dl>
          </Card>

          <Card title="Identifiers & timestamps">
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Meta label="External ID" value={article.external_id} mono />
              <Meta label="URL hash" value={article.url_hash} mono />
              <Meta label="Content hash" value={article.content_hash} mono />
              <Meta
                label="Published"
                value={formatTimestamp(article.published_at)}
              />
              <Meta
                label="Source updated"
                value={formatTimestamp(article.source_updated_at)}
              />
              <Meta
                label="Discovered"
                value={formatTimestamp(article.discovered_at)}
              />
              <Meta
                label="Created"
                value={formatTimestamp(article.created_at)}
              />
              <Meta
                label="Updated"
                value={formatTimestamp(article.updated_at)}
              />
            </dl>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Editorial status">
            <ArticleStatusForm id={article.id} current={article.status} />
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
