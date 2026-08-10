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

import { createTopicAction } from './actions';

export interface ParentOption {
  id: string;
  name: string;
}

/** Create a controlled sub-Topic under a chosen top-level Topic. */
export function CreateTopicForm({
  parents,
}: {
  readonly parents: readonly ParentOption[];
}) {
  const [state, formAction, pending] = useActionState(
    createTopicAction,
    {} as ActionState,
  );
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state.error} />
      {state.ok ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Sub-Topic created.
        </p>
      ) : null}

      <div>
        <label htmlFor="name" className={labelClass}>
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.name} />
      </div>

      <div>
        <label htmlFor="parentId" className={labelClass}>
          Parent (top-level Topic)
        </label>
        <select
          id="parentId"
          name="parentId"
          required
          defaultValue=""
          className={`mt-1 ${inputClass}`}
        >
          <option value="" disabled>
            Select a parent…
          </option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          ))}
        </select>
        <FieldError message={fieldErrors.parentId} />
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>
          Description (optional)
        </label>
        <input
          id="description"
          name="description"
          type="text"
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.description} />
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Creating…' : 'Create sub-Topic'}
      </button>
    </form>
  );
}
