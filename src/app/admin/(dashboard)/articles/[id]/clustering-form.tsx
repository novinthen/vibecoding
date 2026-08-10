'use client';

import { useActionState } from 'react';

import { STORY_ARTICLE_RELATIONSHIPS } from '@/domain/enums';

import {
  buttonClass,
  FormError,
  inputClass,
  labelClass,
  secondaryButtonClass,
} from '../../../_components/ui';
import type { ActionState } from '../../../_lib/action-result';

import {
  attachArticleToStoryAction,
  createStoryFromArticleAction,
  triggerArticleClusteringAction,
} from '../actions';

/**
 * Article clustering controls (Stage 7). Hiding these is never the security
 * boundary — each server action re-checks the mutating-admin authorization.
 */
export function ClusteringControls({ id }: { readonly id: string }) {
  return (
    <div className="space-y-4">
      <RunClusteringForm id={id} />
      <CreateStoryForm id={id} />
      <AttachToStoryForm id={id} />
    </div>
  );
}

function RunClusteringForm({ id }: { readonly id: string }) {
  const action = triggerArticleClusteringAction.bind(null, id);
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );
  return (
    <form action={formAction} className="space-y-2">
      <FormError message={state.error} />
      {state.ok ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          {state.message}
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        <input type="checkbox" name="force" />
        Force (re-cluster if already clustered)
      </label>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Clustering…' : 'Run clustering'}
      </button>
      <p className="text-xs text-neutral-500">
        Groups this Article with the same event when confident, else forms a new
        Story. Never publishes and never edits source facts.
      </p>
    </form>
  );
}

function CreateStoryForm({ id }: { readonly id: string }) {
  const action = createStoryFromArticleAction.bind(null, id);
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );
  return (
    <form
      action={formAction}
      className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800"
    >
      <FormError message={state.error} />
      {state.ok ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          {state.message}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? 'Creating…' : 'Create new Story from this Article'}
      </button>
    </form>
  );
}

function AttachToStoryForm({ id }: { readonly id: string }) {
  const action = attachArticleToStoryAction.bind(null, id);
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );
  return (
    <form
      action={formAction}
      className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800"
    >
      <FormError message={state.error} />
      {state.ok ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          {state.message}
        </p>
      ) : null}
      <div>
        <label htmlFor="attach-storyId" className={labelClass}>
          Attach to Story ID
        </label>
        <input
          id="attach-storyId"
          name="storyId"
          placeholder="Existing Story UUID"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="attach-relationship" className={labelClass}>
          Relationship
        </label>
        <select
          id="attach-relationship"
          name="relationship"
          defaultValue="RELATED"
          className={inputClass}
        >
          {STORY_ARTICLE_RELATIONSHIPS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? 'Attaching…' : 'Attach to Story'}
      </button>
    </form>
  );
}
