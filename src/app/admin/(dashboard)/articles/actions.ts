'use server';

import { revalidatePath } from 'next/cache';

import { requireMutatingAdmin } from '@/admin/auth/current-admin';
import { updateArticleStatus } from '@/admin/services/article-service';
import { withTransaction } from '@/db/client';

import { toActionState, type ActionState } from '../../_lib/action-result';

/** Change an Article's lifecycle status (editorial control). */
export async function updateArticleStatusAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  try {
    await withTransaction((tx) =>
      updateArticleStatus(tx, actor, id, { status: formData.get('status') }),
    );
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(`/admin/articles/${id}`);
  revalidatePath('/admin/articles');
  return { ok: true };
}
