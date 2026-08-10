import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PublicationRepository, PublicationStoryRepository } from '@/domain';

import {
  AdminLink,
  Badge,
  buttonClass,
  Card,
  PageHeader,
  secondaryButtonClass,
} from '../../../_components/ui';
import { EmptyState } from '../../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../../_lib/db';
import {
  removeDomainAction,
  setDomainEnabledAction,
  setPrimaryDomainAction,
  setPublicationStatusAction,
  updatePublicationAction,
} from '../actions';
import { AddDomainForm } from '../domain-form';
import { PublicationForm } from '../publication-form';
import {
  PublicationStatusBadge,
  PublicationStoryStatusBadge,
} from '../status-badge';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

function str(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

export default async function PublicationDetailPage({
  params,
}: {
  readonly params: Params;
}) {
  const { id } = await params;
  if (!isDatabaseConfigured()) notFound();

  const db = getDb();
  const publications = new PublicationRepository(db);
  const pub = await publications.findById(id);
  if (!pub) notFound();

  const [domains, stories] = await Promise.all([
    publications.listDomains(id),
    new PublicationStoryRepository(db).listForPublication(id),
  ]);

  const nextStatuses = (['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const).filter(
    (s) => s !== pub.status,
  );

  return (
    <>
      <PageHeader
        title={pub.name}
        description={`Publication · ${pub.slug} · ${pub.default_locale}`}
        action={
          <>
            <PublicationStatusBadge status={pub.status} />
            <Link href="/admin/publications" className={secondaryButtonClass}>
              Back
            </Link>
          </>
        }
      />

      <div className="space-y-6">
        <Card title="Status">
          <div className="flex flex-wrap items-center gap-2">
            {nextStatuses.map((status) => (
              <form key={status} action={setPublicationStatusAction}>
                <input type="hidden" name="id" value={pub.id} />
                <input type="hidden" name="status" value={status} />
                <button type="submit" className={secondaryButtonClass}>
                  Set {status}
                </button>
              </form>
            ))}
            <p className="ml-1 text-xs text-neutral-500">
              Only ACTIVE Publications resolve publicly through an enabled
              domain.
            </p>
          </div>
        </Card>

        <Card title="Details">
          <PublicationForm
            action={updatePublicationAction.bind(null, pub.id)}
            mode="edit"
            defaults={{
              name: pub.name,
              slug: pub.slug,
              defaultLocale: pub.default_locale,
              timezone: pub.timezone,
              brandingName: str(pub.branding, 'name'),
              tagline: str(pub.branding, 'tagline'),
              seoDescription: str(pub.seo_settings, 'description'),
              positioning: str(pub.editorial_profile, 'positioning'),
              audience: str(pub.editorial_profile, 'audience'),
            }}
          />
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title={`Domains (${domains.length})`}>
              {domains.length === 0 ? (
                <EmptyState message="No domains yet. Add one so this Publication can be served." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-neutral-500">
                      <tr className="border-b border-neutral-200 dark:border-neutral-800">
                        <th className="py-2 pr-3">Domain</th>
                        <th className="py-2 pr-3">Primary</th>
                        <th className="py-2 pr-3">Enabled</th>
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {domains.map((d) => (
                        <tr key={d.id}>
                          <td className="py-2 pr-3 font-mono text-xs">
                            {d.domain}
                          </td>
                          <td className="py-2 pr-3">
                            {d.is_primary ? (
                              <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
                                Primary
                              </Badge>
                            ) : (
                              <form action={setPrimaryDomainAction}>
                                <input
                                  type="hidden"
                                  name="publicationId"
                                  value={pub.id}
                                />
                                <input
                                  type="hidden"
                                  name="domainId"
                                  value={d.id}
                                />
                                <button
                                  type="submit"
                                  className="text-xs text-sky-700 hover:underline dark:text-sky-400"
                                >
                                  Make primary
                                </button>
                              </form>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            {d.enabled ? (
                              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                                Enabled
                              </Badge>
                            ) : (
                              <Badge>Disabled</Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex gap-3">
                              <form action={setDomainEnabledAction}>
                                <input
                                  type="hidden"
                                  name="publicationId"
                                  value={pub.id}
                                />
                                <input
                                  type="hidden"
                                  name="domainId"
                                  value={d.id}
                                />
                                <input
                                  type="hidden"
                                  name="enabled"
                                  value={d.enabled ? 'false' : 'true'}
                                />
                                <button
                                  type="submit"
                                  className="text-xs text-neutral-600 hover:underline dark:text-neutral-400"
                                >
                                  {d.enabled ? 'Disable' : 'Enable'}
                                </button>
                              </form>
                              <form action={removeDomainAction}>
                                <input
                                  type="hidden"
                                  name="publicationId"
                                  value={pub.id}
                                />
                                <input
                                  type="hidden"
                                  name="domainId"
                                  value={d.id}
                                />
                                <button
                                  type="submit"
                                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                                >
                                  Remove
                                </button>
                              </form>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card title="Add domain">
            <AddDomainForm publicationId={pub.id} />
          </Card>
        </div>

        <Card title={`Published stories (${stories.length})`}>
          <div className="mb-3">
            <Link
              href={`/admin/publications/${pub.id}/stories/new`}
              className={buttonClass}
            >
              Attach a Story
            </Link>
          </div>
          {stories.length === 0 ? (
            <EmptyState message="No Stories attached to this Publication yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-neutral-500">
                  <tr className="border-b border-neutral-200 dark:border-neutral-800">
                    <th className="py-2 pr-3">Headline / slug</th>
                    <th className="py-2 pr-3">Canonical Story</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {stories.map((ps) => (
                    <tr key={ps.id}>
                      <td className="py-2 pr-3">
                        <span className="font-medium">
                          {ps.headline ?? ps.story_canonical_title}
                        </span>
                        <div className="text-xs text-neutral-500">
                          {ps.slug ?? '— no slug —'}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-neutral-500">
                        {ps.story_canonical_title}
                        <div className="text-xs">{ps.story_slug}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <PublicationStoryStatusBadge status={ps.status} />
                      </td>
                      <td className="py-2 pr-3">
                        <AdminLink
                          href={`/admin/publications/${pub.id}/stories/${ps.id}`}
                        >
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
      </div>
    </>
  );
}
