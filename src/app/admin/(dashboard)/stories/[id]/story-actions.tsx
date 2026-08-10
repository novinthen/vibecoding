'use client';

import { useActionState } from 'react';

import {
  STORY_REVIEW_STATES,
  STORY_ARTICLE_RELATIONSHIPS,
} from '@/domain/enums';

import {
  buttonClass,
  FormError,
  inputClass,
  labelClass,
  secondaryButtonClass,
} from '../../../_components/ui';
import type { ActionState } from '../../../_lib/action-result';

import {
  detachArticleAction,
  moveArticleAction,
  setStoryReviewStateAction,
} from './actions';

/** Hiding these controls is never the security boundary — every action re-checks. */

export function ReviewStateForm({
  storyId,
  current,
}: {
  readonly storyId: string;
  readonly current: string;
}) {
  const action = setStoryReviewStateAction.bind(null, storyId);
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
      <label htmlFor="reviewState" className={labelClass}>
        Review state
      </label>
      <select
        id="reviewState"
        name="reviewState"
        defaultValue={current}
        className={inputClass}
      >
        {STORY_REVIEW_STATES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : 'Update review state'}
      </button>
      <p className="text-xs text-neutral-500">
        REVIEWED and LOCKED Stories are never modified by automatic clustering.
      </p>
    </form>
  );
}

export function DetachButton({
  storyId,
  articleId,
}: {
  readonly storyId: string;
  readonly articleId: string;
}) {
  const action = detachArticleAction.bind(null, storyId, articleId);
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );
  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending}
        className={`${secondaryButtonClass} !px-2 !py-1 text-xs`}
        title={state.error ?? 'Detach this Article from the Story'}
      >
        {pending ? '…' : 'Detach'}
      </button>
    </form>
  );
}

export function MoveArticleForm({
  storyId,
  members,
}: {
  readonly storyId: string;
  readonly members: { id: string; title: string }[];
}) {
  const action = moveArticleAction.bind(null, storyId);
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
      <div>
        <label htmlFor="move-articleId" className={labelClass}>
          Article
        </label>
        <select id="move-articleId" name="articleId" className={inputClass}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="move-toStoryId" className={labelClass}>
          Target Story ID
        </label>
        <input
          id="move-toStoryId"
          name="toStoryId"
          placeholder="Destination Story UUID"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="move-relationship" className={labelClass}>
          Relationship
        </label>
        <select
          id="move-relationship"
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
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Moving…' : 'Move Article'}
      </button>
    </form>
  );
}
