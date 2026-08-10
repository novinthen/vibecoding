import Link from 'next/link';

import { PublicationRepository } from '@/domain';

import {
  AdminLink,
  Badge,
  buttonClass,
  Card,
  PageHeader,
} from '../../_components/ui';
import { DatabaseUnavailable, EmptyState } from '../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../_lib/db';

import { PublicationStatusBadge } from './status-badge';

export const metadata = { title: 'Publications — Admin' };

/**
 * Publications list (Stage 5B). Each Publication is an independent editorial
 * brand; canonical intelligence stays global. Domains, stories, and
 * localisations are managed on the detail page.
 */
export default async function PublicationsPage() {
  if (!isDatabaseConfigured()) {
    return (
      <>
        <PageHeader title="Publications" />
        <DatabaseUnavailable />
      </>
    );
  }

  const publications = await new PublicationRepository(getDb()).listAll();

  return (
    <>
      <PageHeader
        title="Publications"
        description="Editorial brands. Each has its own domains, locale, Story selection, and SEO identity."
        action={
          <Link href="/admin/publications/new" className={buttonClass}>
            New Publication
          </Link>
        }
      />

      <Card title={`All Publications (${publications.length})`}>
        {publications.length === 0 ? (
          <EmptyState message="No Publications yet. Create one to begin publishing." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-neutral-500">
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Locale</th>
                  <th className="py-2 pr-3">Time zone</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {publications.map((pub) => (
                  <tr key={pub.id}>
                    <td className="py-2 pr-3">
                      <span className="font-medium">{pub.name}</span>
                      <div className="text-xs text-neutral-500">{pub.slug}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge>{pub.default_locale}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-neutral-500">
                      {pub.timezone}
                    </td>
                    <td className="py-2 pr-3">
                      <PublicationStatusBadge status={pub.status} />
                    </td>
                    <td className="py-2 pr-3">
                      <AdminLink href={`/admin/publications/${pub.id}`}>
                        Manage
                      </AdminLink>
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
