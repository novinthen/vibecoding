'use server';

import { revalidatePath } from 'next/cache';

import { resolveConfiguredProvider } from '@/ai';
import { AiProviderError } from '@/ai/provider/errors';
import { requireMutatingAdmin } from '@/admin/auth/current-admin';
import { updateArticleStatus } from '@/admin/services/article-service';
import { triggerArticleEnrichment } from '@/admin/services/enrichment-service';
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

/**
 * Manually trigger AI enrichment for one Article (Stage 6). This is the only path
 * that causes an AI call, keeping cost/execution under explicit human control.
 * AI is optional: if no provider is configured (or it is misconfigured), the
 * action returns a friendly message and nothing is changed. Provider/validation
 * failures are recorded as enrichment versions by the service, so the action
 * still reports success (an attempt was made and persisted) unless the trigger
 * itself was refused.
 */
export async function triggerArticleEnrichmentAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireMutatingAdmin();
  const force = formData.get('force') === 'on';

  let provider;
  try {
    provider = resolveConfiguredProvider();
  } catch (error) {
    if (error instanceof AiProviderError) {
      return {
        error:
          'AI enrichment is not configured. Set AI_PROVIDER (and, for a live ' +
          'provider, AI_API_KEY and AI_MODEL).',
      };
    }
    return toActionState(error);
  }

  let outcome: string;
  try {
    const result = await withTransaction((tx) =>
      triggerArticleEnrichment(tx, actor, provider, id, { force }),
    );
    outcome = result.outcome;
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath(`/admin/articles/${id}`);
  return { ok: true, message: messageForOutcome(outcome) };
}

function messageForOutcome(outcome: string): string {
  switch (outcome) {
    case 'SUCCEEDED':
      return 'Enrichment generated and validated.';
    case 'INVALID_OUTPUT':
      return 'Provider replied but the output failed validation (recorded).';
    case 'PROVIDER_ERROR':
      return 'Provider call failed; the failure was recorded and can be retried.';
    default:
      return 'Enrichment attempt recorded.';
  }
}
