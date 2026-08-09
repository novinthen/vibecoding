import Link from 'next/link';

import { SourceFetchRepository } from '@/domain';
import { SOURCE_FETCH_STATUSES, sourceFetchStatusSchema } from '@/domain/enums';

import {
  AdminLink,
  Card,
  FetchStatusBadge,
  formatTimestamp,
  PageHeader,
} from '../../_components/ui';
import { DatabaseUnavailable, EmptyState } from '../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../_lib/db';

export default async function FetchesPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ status?: string }>;
}) {
  if (!isDatabaseConfigured()) {
    return (
      <>
        <PageHeader title="Fetches" />
        <DatabaseUnavailable />
      </>
    );
  }

  const { status: statusParam } = await searchParams;
  const parsedStatus = sourceFetchStatusSchema.safeParse(statusParam);
  const status = parsedStatus.success ? parsedStatus.data : undefined;

  const fetches = await new SourceFetchRepository(getDb()).listRecentGlobal({
    limit: 100,
    status,
  });

  return (
    <>
      <PageHeader
        title="Fetches"
        description="Recent fetch attempts across all Sources."
      />

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <FilterChip label="All" href="/admin/fetches" active={!status} />
        {SOURCE_FETCH_STATUSES.map((value) => (
          <FilterChip
            key={value}
            label={value}
            href={`/admin/fetches?status=${value}`}
            active={status === value}
          />
        ))}
      </div>

      <Card>
        {fetches.length === 0 ? (
          <EmptyState message="No fetch attempts match this filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-neutral-500">
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">HTTP</th>
                  <th className="py-2 pr-3">Found</th>
                  <th className="py-2 pr-3">New</th>
                  <th className="py-2 pr-3">ms</th>
                  <th className="py-2 pr-3">Started</th>
                  <th className="py-2 pr-3">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {fetches.map((fetch) => (
                  <tr key={fetch.id}>
                    <td className="py-2 pr-3">
                      <AdminLink href={`/admin/sources/${fetch.source_id}`}>
                        {fetch.source_name}
                      </AdminLink>
                    </td>
                    <td className="py-2 pr-3">
                      <FetchStatusBadge status={fetch.status} />
                    </td>
                    <td className="py-2 pr-3">{fetch.http_status ?? '—'}</td>
                    <td className="py-2 pr-3">{fetch.items_found ?? '—'}</td>
                    <td className="py-2 pr-3">{fetch.items_new ?? '—'}</td>
                    <td className="py-2 pr-3">{fetch.duration_ms ?? '—'}</td>
                    <td className="py-2 pr-3 text-neutral-500">
                      {formatTimestamp(fetch.started_at)}
                    </td>
                    <td className="py-2 pr-3 text-xs text-red-600 dark:text-red-400">
                      {fetch.error_code ?? ''}
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

function FilterChip({
  label,
  href,
  active,
}: {
  readonly label: string;
  readonly href: string;
  readonly active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 ${
        active
          ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
          : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
      }`}
    >
      {label}
    </Link>
  );
}
