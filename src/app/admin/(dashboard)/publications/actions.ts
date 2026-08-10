'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { requireMutatingAdmin } from '@/admin/auth/current-admin';
import {
  addPublicationDomain,
  createPublication,
  removePublicationDomain,
  setPrimaryPublicationDomain,
  setPublicationDomainEnabled,
  setPublicationStatus,
  updatePublication,
} from '@/admin/services/publication-service';
import { withTransaction } from '@/db/client';

import { toActionState, type ActionState } from '../../_lib/action-result';

/**
 * Publication + PublicationDomain server actions (Stage 5B).
 *
 * Each re-verifies authorization server-side via requireMutatingAdmin before
 * touching the database, and runs inside a transaction so the mutation and its
 * audit row commit atomically. UI never *is* the security boundary.
 */

function publicationInputFromForm(formData: FormData) {
  return {
    name: formData.get('name'),
    slug: formData.get('slug') || undefined,
    defaultLocale: formData.get('defaultLocale'),
    timezone: formData.get('timezone'),
    brandingName: formData.get('brandingName') ?? '',
    tagline: formData.get('tagline') ?? '',
    seoDescription: formData.get('seoDescription') ?? '',
    positioning: formData.get('positioning') ?? '',
    audience: formData.get('audience') ?? '',
  };
}

export async function createPublicationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  let id: string;
  try {
    const created = await withTransaction((tx) =>
      createPublication(tx, actor, publicationInputFromForm(formData)),
    );
    id = created.id;
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath('/admin/publications');
  redirect(`/admin/publications/${id}`);
}

export async function updatePublicationAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  try {
    await withTransaction((tx) =>
      updatePublication(tx, actor, id, publicationInputFromForm(formData)),
    );
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(`/admin/publications/${id}`);
  redirect(`/admin/publications/${id}`);
}

export async function setPublicationStatusAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireMutatingAdmin();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id) return;
  await withTransaction((tx) =>
    setPublicationStatus(tx, actor, id, { status }),
  );
  revalidatePath('/admin/publications');
  revalidatePath(`/admin/publications/${id}`);
}

export async function addDomainAction(
  publicationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  try {
    await withTransaction((tx) =>
      addPublicationDomain(tx, actor, publicationId, {
        domain: formData.get('domain'),
        isPrimary: formData.get('isPrimary') === 'true',
      }),
    );
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(`/admin/publications/${publicationId}`);
  return { ok: true };
}

export async function setDomainEnabledAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireMutatingAdmin();
  const publicationId = String(formData.get('publicationId') ?? '');
  const domainId = String(formData.get('domainId') ?? '');
  const enabled = formData.get('enabled') === 'true';
  if (!publicationId || !domainId) return;
  await withTransaction((tx) =>
    setPublicationDomainEnabled(tx, actor, publicationId, domainId, enabled),
  );
  revalidatePath(`/admin/publications/${publicationId}`);
}

export async function setPrimaryDomainAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireMutatingAdmin();
  const publicationId = String(formData.get('publicationId') ?? '');
  const domainId = String(formData.get('domainId') ?? '');
  if (!publicationId || !domainId) return;
  await withTransaction((tx) =>
    setPrimaryPublicationDomain(tx, actor, publicationId, domainId),
  );
  revalidatePath(`/admin/publications/${publicationId}`);
}

export async function removeDomainAction(formData: FormData): Promise<void> {
  const actor = await requireMutatingAdmin();
  const publicationId = String(formData.get('publicationId') ?? '');
  const domainId = String(formData.get('domainId') ?? '');
  if (!publicationId || !domainId) return;
  await withTransaction((tx) =>
    removePublicationDomain(tx, actor, publicationId, domainId),
  );
  revalidatePath(`/admin/publications/${publicationId}`);
}
