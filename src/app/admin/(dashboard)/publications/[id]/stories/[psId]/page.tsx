import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  PublicationRepository,
  PublicationStoryRepository,
  StoryLocalizationRepository,
  StoryRepository,
} from '@/domain';
import {
  PUBLICATION_STORY_STATUSES,
  LOCALIZATION_STATUSES,
} from '@/domain/enums';

import {
  Badge,
  Card,
  PageHeader,
  secondaryButtonClass,
} from '../../../../../_components/ui';
import { EmptyState } from '../../../../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../../../../_lib/db';
import {
  createLocalizationAction,
  setLocalizationStatusAction,
  setPublicationStoryStatusAction,
  updateLocalizationAction,
  updatePublicationStoryAction,
} from '../actions';
import { LocalizationForm, PublicationStoryForm } from '../story-forms';
import {
  LocalizationStatusBadge,
  PublicationStoryStatusBadge,
} from '../../../status-badge';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string; psId: string }>;

export default async function PublicationStoryDetailPage({
  params,
}: {
  readonly params: Params;
}) {
  const { id, psId } = await params;
  if (!isDatabaseConfigured()) notFound();

  const db = getDb();
  const [pub, ps] = await Promise.all([
    new PublicationRepository(db).findById(id),
    new PublicationStoryRepository(db).findById(psId),
  ]);
  // The PublicationStory must belong to the Publication in the route.
  if (!pub || !ps || ps.publication_id !== id) notFound();

  const [story, localizations] = await Promise.all([
    new StoryRepository(db).findById(ps.story_id),
    new StoryLocalizationRepository(db).listForPublicationStory(psId),
  ]);

  const nextStatuses = PUBLICATION_STORY_STATUSES.filter(
    (s) => s !== ps.status,
  );

  return (
    <>
      <PageHeader
        title={ps.headline ?? story?.canonical_title ?? 'Publication Story'}
        description={`${pub.name} · default locale ${pub.default_locale}`}
        action={
          <>
            <PublicationStoryStatusBadge status={ps.status} />
            <Link
              href={`/admin/publications/${pub.id}`}
              className={secondaryButtonClass}
            >
              Back
            </Link>
          </>
        }
      />

      <div className="space-y-6">
        <Card title="Canonical Story (facts — read-only)">
          {story ? (
            <div className="text-sm">
              <p className="font-medium">{story.canonical_title}</p>
              <p className="text-xs text-neutral-500">
                {story.slug} · status {story.status}
              </p>
              <p className="mt-2 text-xs text-neutral-500">
                Canonical facts are never edited here. This screen only controls
                how {pub.name} presents and localises the Story.
              </p>
            </div>
          ) : (
            <EmptyState message="Canonical Story not found." />
          )}
        </Card>

        <Card title="Publishing status">
          <div className="flex flex-wrap items-center gap-2">
            {nextStatuses.map((status) => (
              <form key={status} action={setPublicationStoryStatusAction}>
                <input type="hidden" name="publicationId" value={pub.id} />
                <input type="hidden" name="publicationStoryId" value={ps.id} />
                <input type="hidden" name="status" value={status} />
                <button type="submit" className={secondaryButtonClass}>
                  Set {status}
                </button>
              </form>
            ))}
            <p className="ml-1 text-xs text-neutral-500">
              Only PUBLISHED stories render publicly (a slug is required).
            </p>
          </div>
        </Card>

        <Card title="Publication presentation">
          <PublicationStoryForm
            action={updatePublicationStoryAction.bind(null, pub.id, ps.id)}
            mode="edit"
            defaults={{
              slug: ps.slug ?? '',
              headline: ps.headline ?? '',
              publishedSummary: ps.published_summary ?? '',
              publishedWhyItMatters: ps.published_why_it_matters ?? '',
              featured: ps.featured,
              editorialPriority: ps.editorial_priority,
            }}
          />
        </Card>

        <Card title={`Localisations (${localizations.length})`}>
          <p className="mb-3 text-xs text-neutral-500">
            One row per locale. Published localisations override the default
            publication copy for their locale; nothing is borrowed from another
            Publication.
          </p>
          {localizations.length === 0 ? (
            <EmptyState message="No localisations yet. Add one below." />
          ) : (
            <div className="space-y-4">
              {localizations.map((loc) => (
                <div
                  key={loc.id}
                  className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge className="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      {loc.locale}
                    </Badge>
                    <LocalizationStatusBadge status={loc.status} />
                    {loc.translation_source ? (
                      <span className="text-xs text-neutral-500">
                        {loc.translation_source}
                      </span>
                    ) : null}
                    {loc.reviewed_by ? (
                      <span className="text-xs text-neutral-500">
                        reviewed by {loc.reviewed_by}
                      </span>
                    ) : null}
                  </div>

                  <div className="mb-3 flex flex-wrap gap-2">
                    {LOCALIZATION_STATUSES.filter((s) => s !== loc.status).map(
                      (status) => (
                        <form key={status} action={setLocalizationStatusAction}>
                          <input
                            type="hidden"
                            name="publicationId"
                            value={pub.id}
                          />
                          <input
                            type="hidden"
                            name="publicationStoryId"
                            value={ps.id}
                          />
                          <input
                            type="hidden"
                            name="localizationId"
                            value={loc.id}
                          />
                          <input type="hidden" name="status" value={status} />
                          <button
                            type="submit"
                            className="text-xs text-neutral-600 hover:underline dark:text-neutral-400"
                          >
                            Set {status}
                          </button>
                        </form>
                      ),
                    )}
                  </div>

                  <LocalizationForm
                    action={updateLocalizationAction.bind(
                      null,
                      pub.id,
                      ps.id,
                      loc.id,
                    )}
                    mode="edit"
                    defaults={{
                      locale: loc.locale,
                      headline: loc.headline ?? '',
                      summary: loc.summary ?? '',
                      whyItMatters: loc.why_it_matters ?? '',
                      translationSource: loc.translation_source ?? '',
                      modelProvider: loc.model_provider ?? '',
                      modelName: loc.model_name ?? '',
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Add localisation">
          <LocalizationForm
            action={createLocalizationAction.bind(null, pub.id, ps.id)}
            mode="create"
            defaults={{ locale: pub.default_locale }}
          />
        </Card>
      </div>
    </>
  );
}
