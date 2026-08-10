'use client';

import { useActionState } from 'react';

import {
  buttonClass,
  FieldError,
  FormError,
  inputClass,
  labelClass,
} from '../../_components/ui';
import type { ActionState } from '../../_lib/action-result';

import { addDomainAction } from './actions';

/** Add a domain to a Publication. Domains are globally unique (validated server-side). */
export function AddDomainForm({
  publicationId,
}: {
  readonly publicationId: string;
}) {
  const action = addDomainAction.bind(null, publicationId);
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state.error} />
      {state.ok ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Domain added.
        </p>
      ) : null}

      <div>
        <label htmlFor="domain" className={labelClass}>
          Hostname
        </label>
        <input
          id="domain"
          name="domain"
          type="text"
          required
          placeholder="news.example.com"
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.domain} />
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        <input type="checkbox" name="isPrimary" value="true" />
        Mark as primary domain
      </label>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Adding…' : 'Add domain'}
      </button>
    </form>
  );
}
