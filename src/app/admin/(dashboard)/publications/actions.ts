'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { requireMutatingAdmin } from '@/admin/auth/current-admin';
import { AdminValidationError } from '@/admin/errors';
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
 * Run a void (button-form) mutation and surface a business-rule violation as a
 * friendly banner on the Publication page (via `?error=`), instead of an
 * unhandled 500. Unexpected errors still propagate. `redirect` is called after
 * the try/catch so its control-flow throw is never swallowed.
 */
async function runReporting(
  publicationId: string,
  fn: () => Promise<void>,
): Promise<void> {
  let errorMessage: string | null = null;
  try {
    await fn();
  } catch (error) {
    if (error instanceof AdminValidationError) errorMessage = error.message;
    else throw error;
  }
  revalidatePath('/admin/publications');
  revalidatePath(`/admin/publications/${publicationId}`);
  if (errorMessage) {
    redirect(
      `/admin/publications/${publicationId}?error=${encodeURIComponent(errorMessage)}`,
    );
  }
}

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
  await runReporting(id, async () => {
    await withTransaction((tx) =>
      setPublicationStatus(tx, actor, id, { status }),
    );
  });
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
  await runReporting(publicationId, async () => {
    await withTransaction((tx) =>
      setPublicationDomainEnabled(tx, actor, publicationId, domainId, enabled),
    );
  });
}

export async function setPrimaryDomainAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireMutatingAdmin();
  const publicationId = String(formData.get('publicationId') ?? '');
  const domainId = String(formData.get('domainId') ?? '');
  if (!publicationId || !domainId) return;
  await runReporting(publicationId, async () => {
    await withTransaction((tx) =>
      setPrimaryPublicationDomain(tx, actor, publicationId, domainId),
    );
  });
}

export async function removeDomainAction(formData: FormData): Promise<void> {
  const actor = await requireMutatingAdmin();
  const publicationId = String(formData.get('publicationId') ?? '');
  const domainId = String(formData.get('domainId') ?? '');
  if (!publicationId || !domainId) return;
  await runReporting(publicationId, async () => {
    await withTransaction((tx) =>
      removePublicationDomain(tx, actor, publicationId, domainId),
    );
  });
}
