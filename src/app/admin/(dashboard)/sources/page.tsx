import Link from 'next/link';

import { SourceRepository } from '@/domain';

import {
  AdminLink,
  Badge,
  buttonClass,
  Card,
  formatTimestamp,
  HealthBadge,
  PageHeader,
} from '../../_components/ui';
import { DatabaseUnavailable, EmptyState } from '../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../_lib/db';

export default async function SourcesPage() {
  if (!isDatabaseConfigured()) {
    return (
      <>
        <PageHeader title="Sources" />
        <DatabaseUnavailable />
      </>
    );
  }

  const sources = await new SourceRepository(getDb()).listAll();

  return (
    <>
      <PageHeader
        title="Sources"
        description={`${sources.length} configured`}
        action={
          <Link href="/admin/sources/new" className={buttonClass}>
            New Source
          </Link>
        }
      />

      <Card>
        {sources.length === 0 ? (
          <EmptyState message="No Sources configured yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-neutral-500">
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Tier</th>
                  <th className="py-2 pr-4">Health</th>
                  <th className="py-2 pr-4">Enabled</th>
                  <th className="py-2 pr-4">Failures</th>
                  <th className="py-2 pr-4">Last success</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {sources.map((source) => (
                  <tr key={source.id}>
                    <td className="py-2 pr-4">
                      <AdminLink href={`/admin/sources/${source.id}`}>
                        {source.name}
                      </AdminLink>
                      <div className="text-xs text-neutral-500">
                        {source.slug}
                      </div>
                    </td>
                    <td className="py-2 pr-4">{source.source_type}</td>
                    <td className="py-2 pr-4">{source.authority_tier}</td>
                    <td className="py-2 pr-4">
                      <HealthBadge status={source.health_status} />
                    </td>
                    <td className="py-2 pr-4">
                      {source.enabled ? (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                          Enabled
                        </Badge>
                      ) : (
                        <Badge>Disabled</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4">{source.failure_count}</td>
                    <td className="py-2 pr-4 text-neutral-500">
                      {formatTimestamp(source.last_success_at)}
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
