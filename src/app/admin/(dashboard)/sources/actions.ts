'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { requireMutatingAdmin } from '@/admin/auth/current-admin';
import {
  createSource,
  setSourceEnabled,
  triggerSourceIngestion,
  updateSource,
} from '@/admin/services/source-service';
import { withTransaction } from '@/db/client';
import { getPool } from '@/db/client';

import { toActionState, type ActionState } from '../../_lib/action-result';

/**
 * Source server actions — thin adapters over the source service.
 *
 * Each re-verifies authorization server-side via requireMutatingAdmin (which
 * redirects the unauthenticated and rejects read-only VIEWERs) before touching
 * the database. Create/edit run inside a transaction so the mutation and its
 * audit row commit atomically. Manual ingestion runs against the pool (it makes
 * a network call and must not hold a transaction open across I/O).
 */

function sourceInputFromForm(formData: FormData) {
  return {
    name: formData.get('name'),
    slug: formData.get('slug') || undefined,
    sourceType: formData.get('sourceType'),
    authorityTier: formData.get('authorityTier'),
    homepageUrl: formData.get('homepageUrl') ?? '',
    feedUrl: formData.get('feedUrl') ?? '',
    language: formData.get('language') ?? '',
    pollInterval: formData.get('pollInterval') ?? '',
    defaultTopicId: formData.get('defaultTopicId') ?? '',
    sourceConfig: formData.get('sourceConfig') ?? '',
  };
}

export async function createSourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  let id: string;
  try {
    const created = await withTransaction((tx) =>
      createSource(tx, actor, sourceInputFromForm(formData)),
    );
    id = created.id;
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath('/admin/sources');
  redirect(`/admin/sources/${id}`);
}

export async function updateSourceAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  const input = sourceInputFromForm(formData);
  try {
    await withTransaction((tx) => updateSource(tx, actor, id, input));
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(`/admin/sources/${id}`);
  redirect(`/admin/sources/${id}`);
}

export async function setSourceEnabledAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireMutatingAdmin();
  const id = String(formData.get('id') ?? '');
  const enabled = formData.get('enabled') === 'true';
  if (!id) return;
  await withTransaction((tx) => setSourceEnabled(tx, actor, id, enabled));
  revalidatePath('/admin/sources');
  revalidatePath(`/admin/sources/${id}`);
}

export async function triggerIngestionAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireMutatingAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  // Not wrapped in a transaction: ingestion performs network I/O and manages its
  // own writes (SourceFetch, Article, health) through the Stage 3 engine.
  await triggerSourceIngestion(getPool(), actor, id);
  revalidatePath('/admin/sources');
  revalidatePath(`/admin/sources/${id}`);
  revalidatePath('/admin/fetches');
}
