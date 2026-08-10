import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PublicationRepository, StoryRepository } from '@/domain';

import {
  Card,
  PageHeader,
  secondaryButtonClass,
} from '../../../../../_components/ui';
import { EmptyState } from '../../../../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../../../../_lib/db';
import { createPublicationStoryAction } from '../actions';
import { PublicationStoryForm, type StoryOption } from '../story-forms';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export default async function AttachStoryPage({
  params,
}: {
  readonly params: Params;
}) {
  const { id } = await params;
  if (!isDatabaseConfigured()) notFound();

  const db = getDb();
  const pub = await new PublicationRepository(db).findById(id);
  if (!pub) notFound();

  // Only REAL canonical Stories are offered — Stage 5B never fabricates Stories.
  const stories = await new StoryRepository(db).listRecent(200);
  const options: StoryOption[] = stories.map((s) => ({
    id: s.id,
    label: `${s.canonical_title} (${s.slug})`,
  }));

  return (
    <>
      <PageHeader
        title="Attach a Story"
        description={`Publish a canonical Story through ${pub.name}. Presentation only — canonical facts are never changed.`}
        action={
          <Link
            href={`/admin/publications/${pub.id}`}
            className={secondaryButtonClass}
          >
            Back
          </Link>
        }
      />
      <Card>
        {options.length === 0 ? (
          <EmptyState message="No canonical Stories exist yet. Stories appear here once the intelligence backend has them; none are fabricated." />
        ) : (
          <PublicationStoryForm
            action={createPublicationStoryAction.bind(null, pub.id)}
            mode="create"
            stories={options}
          />
        )}
      </Card>
    </>
  );
}
