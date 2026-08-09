'use client';

import { useActionState } from 'react';

import { ARTICLE_STATUSES } from '@/domain/enums';

import { buttonClass, FormError, inputClass } from '../../_components/ui';
import type { ActionState } from '../../_lib/action-result';

import { updateArticleStatusAction } from './actions';

/** Inline status-change control on the Article detail page. */
export function ArticleStatusForm({
  id,
  current,
}: {
  readonly id: string;
  readonly current: string;
}) {
  const action = updateArticleStatusAction.bind(null, id);
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );

  return (
    <form action={formAction} className="space-y-2">
      <FormError message={state.error} />
      {state.ok ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Status updated.
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <select
          name="status"
          defaultValue={current}
          className={`${inputClass} max-w-xs`}
        >
          {ARTICLE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Saving…' : 'Update status'}
        </button>
      </div>
    </form>
  );
}
