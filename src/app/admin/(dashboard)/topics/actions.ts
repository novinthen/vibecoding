'use server';

import { revalidatePath } from 'next/cache';

import { requireMutatingAdmin } from '@/admin/auth/current-admin';
import { createTopic, setTopicEnabled } from '@/admin/services/topic-service';
import { withTransaction } from '@/db/client';

import { toActionState, type ActionState } from '../../_lib/action-result';

/** Create a controlled sub-Topic under an existing top-level Topic. */
export async function createTopicAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  try {
    await withTransaction((tx) =>
      createTopic(tx, actor, {
        name: formData.get('name'),
        slug: formData.get('slug') || undefined,
        description: formData.get('description') ?? '',
        parentId: formData.get('parentId'),
      }),
    );
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath('/admin/topics');
  return { ok: true };
}

/** Enable or disable a Topic. */
export async function setTopicEnabledAction(formData: FormData): Promise<void> {
  const actor = await requireMutatingAdmin();
  const id = String(formData.get('id') ?? '');
  const enabled = formData.get('enabled') === 'true';
  if (!id) return;
  await withTransaction((tx) => setTopicEnabled(tx, actor, id, enabled));
  revalidatePath('/admin/topics');
}
