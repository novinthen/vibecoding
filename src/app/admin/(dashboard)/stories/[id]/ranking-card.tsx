'use client';

import { useActionState } from 'react';
import { triggerRankingAction } from './actions';
import type { ActionState } from '../../../_lib/action-result';

export function TriggerRankingButton({
  storyId,
  publicationId,
}: {
  readonly storyId: string;
  readonly publicationId?: string | null;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    triggerRankingAction.bind(null, storyId),
    { ok: true },
  );

  return (
    <form action={formAction} className="space-y-2">
      {publicationId && (
        <input type="hidden" name="publicationId" value={publicationId} />
      )}
      <input type="hidden" name="force" value="true" />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
      >
        {pending ? 'Calculating...' : 'Recalculate Ranking'}
      </button>
      {!state.ok && state.message && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}
      {state.ok && state.message && (
        <p className="text-sm text-green-600">{state.message}</p>
      )}
    </form>
  );
}
