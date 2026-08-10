'use client';

import { useActionState } from 'react';

import { buttonClass, FormError } from '../../../_components/ui';
import type { ActionState } from '../../../_lib/action-result';

import { triggerArticleEnrichmentAction } from '../actions';

/**
 * Inline control to trigger AI enrichment for one Article (Stage 6). Hiding this
 * is never the security control — the server action re-checks the mutating-admin
 * authorization. `force` overrides the eligibility gate for a deliberate re-run.
 */
export function EnrichmentTriggerForm({ id }: { readonly id: string }) {
  const action = triggerArticleEnrichmentAction.bind(null, id);
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );

  return (
    <form action={formAction} className="space-y-2">
      <FormError message={state.error} />
      {state.ok ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          {state.message ?? 'Enrichment attempt recorded.'}
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        <input type="checkbox" name="force" />
        Force (bypass eligibility)
      </label>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Enriching…' : 'Run AI enrichment'}
      </button>
      <p className="text-xs text-neutral-500">
        Runs one bounded AI call. Output is advisory and is never published
        automatically.
      </p>
    </form>
  );
}
