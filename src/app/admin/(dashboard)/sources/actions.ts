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
    sourceConfig: sourceConfigFromForm(formData),
  };
}

/**
 * Assemble the source-type-specific adapter config from the operator-friendly
 * form fields into a plain object. Returns `undefined` for types that carry no
 * config (RSS/Atom/…). Numeric fields are omitted when blank so the schema's
 * defaults apply. This only SHAPES the input; the source service performs the
 * authoritative per-type Zod validation (owner/repo/mode/bounds), and no secret
 * (e.g. a GitHub token) is ever accepted here.
 */
function sourceConfigFromForm(
  formData: FormData,
): Record<string, unknown> | undefined {
  const type = String(formData.get('sourceType') ?? '');
  const str = (name: string) => String(formData.get(name) ?? '').trim();
  const num = (name: string): number | undefined => {
    const raw = str(name);
    if (raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number.NaN; // NaN → schema rejects it.
  };

  if (type === 'GITHUB') {
    const config: Record<string, unknown> = {
      owner: str('cfg_owner'),
      repo: str('cfg_repo'),
      prereleases: str('cfg_prereleases') || 'exclude',
    };
    const perPage = num('cfg_perPage');
    const maxPages = num('cfg_maxPages');
    if (perPage !== undefined) config.perPage = perPage;
    if (maxPages !== undefined) config.maxPages = maxPages;
    return config;
  }

  if (type === 'HACKER_NEWS') {
    const mode = str('cfg_mode') || 'top';
    const config: Record<string, unknown> = { mode };
    const maxItems = num('cfg_maxItems');
    if (maxItems !== undefined) config.maxItems = maxItems;
    if (mode === 'ids') {
      config.ids = str('cfg_ids')
        .split(/[\s,]+/)
        .filter((s) => s.length > 0)
        .map((s) => Number(s));
    }
    return config;
  }

  // RSS / ATOM / RSSHUB / API / MANUAL carry no adapter config.
  return undefined;
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
