'use server';

import { revalidatePath } from 'next/cache';

import { requireMutatingAdmin } from '@/admin/auth/current-admin';
import {
  detachArticleFromStory,
  moveArticleBetweenStories,
  setStoryReviewState,
} from '@/admin/services/clustering-service';
import { withTransaction } from '@/db/client';

import { toActionState, type ActionState } from '../../../_lib/action-result';

/** Set a Story's clustering review state (protects it from auto-restructuring). */
export async function setStoryReviewStateAction(
  storyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  try {
    await withTransaction((tx) =>
      setStoryReviewState(tx, actor, {
        storyId,
        reviewState: formData.get('reviewState'),
      }),
    );
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(`/admin/stories/${storyId}`);
  return { ok: true, message: 'Review state updated.' };
}

/** Detach an Article from a Story (audited). */
export async function detachArticleAction(
  storyId: string,
  articleId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  try {
    await withTransaction((tx) =>
      detachArticleFromStory(tx, actor, { storyId, articleId }),
    );
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(`/admin/stories/${storyId}`);
  return { ok: true, message: 'Article detached.' };
}

/** Move an Article from this Story to another (audited, single transaction). */
export async function moveArticleAction(
  fromStoryId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  const articleId = String(formData.get('articleId') ?? '');
  const toStoryId = String(formData.get('toStoryId') ?? '').trim();
  try {
    await withTransaction((tx) =>
      moveArticleBetweenStories(tx, actor, {
        fromStoryId,
        toStoryId,
        articleId,
        relationship: formData.get('relationship'),
      }),
    );
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(`/admin/stories/${fromStoryId}`);
  revalidatePath(`/admin/stories/${toStoryId}`);
  return { ok: true, message: 'Article moved.' };
}
