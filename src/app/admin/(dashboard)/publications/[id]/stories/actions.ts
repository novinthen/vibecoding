'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { requireMutatingAdmin } from '@/admin/auth/current-admin';
import {
  createPublicationStory,
  setPublicationStoryStatus,
  updatePublicationStory,
} from '@/admin/services/publication-story-service';
import {
  createStoryLocalization,
  setStoryLocalizationStatus,
  updateStoryLocalization,
} from '@/admin/services/story-localization-service';
import { withTransaction } from '@/db/client';

import {
  toActionState,
  type ActionState,
} from '../../../../_lib/action-result';

/**
 * PublicationStory + StoryLocalization server actions (Stage 5B).
 *
 * All re-verify authorization server-side and run inside a transaction so the
 * mutation and its audit row commit atomically. None of these touch canonical
 * Story facts — only per-Publication presentation and locale variants.
 */

function publicationStoryInputFromForm(formData: FormData) {
  return {
    storyId: formData.get('storyId'),
    slug: formData.get('slug'),
    headline: formData.get('headline') ?? '',
    publishedSummary: formData.get('publishedSummary') ?? '',
    publishedWhyItMatters: formData.get('publishedWhyItMatters') ?? '',
    featured: formData.get('featured') === 'true',
    editorialPriority: formData.get('editorialPriority') ?? '0',
  };
}

export async function createPublicationStoryAction(
  publicationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  let id: string;
  try {
    const created = await withTransaction((tx) =>
      createPublicationStory(
        tx,
        actor,
        publicationId,
        publicationStoryInputFromForm(formData),
      ),
    );
    id = created.id;
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(`/admin/publications/${publicationId}`);
  redirect(`/admin/publications/${publicationId}/stories/${id}`);
}

export async function updatePublicationStoryAction(
  publicationId: string,
  publicationStoryId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  try {
    await withTransaction((tx) =>
      updatePublicationStory(
        tx,
        actor,
        publicationStoryId,
        publicationStoryInputFromForm(formData),
      ),
    );
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(
    `/admin/publications/${publicationId}/stories/${publicationStoryId}`,
  );
  return { ok: true };
}

export async function setPublicationStoryStatusAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireMutatingAdmin();
  const publicationId = String(formData.get('publicationId') ?? '');
  const publicationStoryId = String(formData.get('publicationStoryId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!publicationId || !publicationStoryId) return;
  await withTransaction((tx) =>
    setPublicationStoryStatus(tx, actor, publicationStoryId, { status }),
  );
  revalidatePath(`/admin/publications/${publicationId}`);
  revalidatePath(
    `/admin/publications/${publicationId}/stories/${publicationStoryId}`,
  );
}

// --- Localisations ---------------------------------------------------------

function localizationInputFromForm(formData: FormData) {
  return {
    locale: formData.get('locale'),
    headline: formData.get('headline') ?? '',
    summary: formData.get('summary') ?? '',
    whyItMatters: formData.get('whyItMatters') ?? '',
    translationSource: formData.get('translationSource') ?? '',
    modelProvider: formData.get('modelProvider') ?? '',
    modelName: formData.get('modelName') ?? '',
  };
}

export async function createLocalizationAction(
  publicationId: string,
  publicationStoryId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  try {
    await withTransaction((tx) =>
      createStoryLocalization(
        tx,
        actor,
        publicationStoryId,
        localizationInputFromForm(formData),
      ),
    );
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(
    `/admin/publications/${publicationId}/stories/${publicationStoryId}`,
  );
  return { ok: true };
}

export async function updateLocalizationAction(
  publicationId: string,
  publicationStoryId: string,
  localizationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  try {
    await withTransaction((tx) =>
      updateStoryLocalization(
        tx,
        actor,
        localizationId,
        localizationInputFromForm(formData),
      ),
    );
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(
    `/admin/publications/${publicationId}/stories/${publicationStoryId}`,
  );
  return { ok: true };
}

export async function setLocalizationStatusAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireMutatingAdmin();
  const publicationId = String(formData.get('publicationId') ?? '');
  const publicationStoryId = String(formData.get('publicationStoryId') ?? '');
  const localizationId = String(formData.get('localizationId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!publicationId || !publicationStoryId || !localizationId) return;
  await withTransaction((tx) =>
    setStoryLocalizationStatus(tx, actor, localizationId, { status }),
  );
  revalidatePath(
    `/admin/publications/${publicationId}/stories/${publicationStoryId}`,
  );
}
