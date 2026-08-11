'use client';

import { useActionState } from 'react';

import { AUTHORITY_TIERS, SOURCE_TYPES } from '@/domain/enums';

import {
  buttonClass,
  FieldError,
  FormError,
  inputClass,
  labelClass,
} from '../../_components/ui';
import type { ActionState } from '../../_lib/action-result';

export interface SourceFormValues {
  name: string;
  slug: string;
  sourceType: string;
  authorityTier: string;
  homepageUrl: string;
  feedUrl: string;
  language: string;
  pollInterval: string;
  defaultTopicId: string;
  sourceConfig: string;
}

export interface TopicOption {
  id: string;
  name: string;
}

const EMPTY: SourceFormValues = {
  name: '',
  slug: '',
  sourceType: 'RSS',
  authorityTier: 'SPECIALIST',
  homepageUrl: '',
  feedUrl: '',
  language: 'en',
  pollInterval: '',
  defaultTopicId: '',
  sourceConfig: '',
};

/**
 * Create/edit form for a Source. In edit mode the slug and type are shown
 * read-only (they are immutable identity/adapter selectors) and are not
 * submitted. The action prop carries authorization + validation + audit.
 */
export function SourceForm({
  action,
  topics,
  mode,
  initial,
  submitLabel,
}: {
  readonly action: (
    prev: ActionState,
    formData: FormData,
  ) => Promise<ActionState>;
  readonly topics: readonly TopicOption[];
  readonly mode: 'create' | 'edit';
  readonly initial?: Partial<SourceFormValues>;
  readonly submitLabel: string;
}) {
  const values = { ...EMPTY, ...initial };
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <FormError message={state.error} />

      <div>
        <label htmlFor="name" className={labelClass}>
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={values.name}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.name} />
      </div>

      <div>
        <label htmlFor="slug" className={labelClass}>
          Slug{' '}
          {mode === 'create' ? '(optional — derived from name)' : '(immutable)'}
        </label>
        <input
          id="slug"
          name="slug"
          type="text"
          defaultValue={values.slug}
          readOnly={mode === 'edit'}
          className={`mt-1 ${inputClass} ${mode === 'edit' ? 'opacity-60' : ''}`}
        />
        <FieldError message={fieldErrors.slug} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="sourceType" className={labelClass}>
            Type {mode === 'edit' ? '(immutable)' : ''}
          </label>
          {mode === 'edit' ? (
            <input
              id="sourceType"
              type="text"
              value={values.sourceType}
              readOnly
              className={`mt-1 ${inputClass} opacity-60`}
            />
          ) : (
            <select
              id="sourceType"
              name="sourceType"
              defaultValue={values.sourceType}
              className={`mt-1 ${inputClass}`}
            >
              {SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          )}
          <FieldError message={fieldErrors.sourceType} />
        </div>

        <div>
          <label htmlFor="authorityTier" className={labelClass}>
            Authority tier
          </label>
          <select
            id="authorityTier"
            name="authorityTier"
            defaultValue={values.authorityTier}
            className={`mt-1 ${inputClass}`}
          >
            {AUTHORITY_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.authorityTier} />
        </div>
      </div>

      <div>
        <label htmlFor="feedUrl" className={labelClass}>
          Feed URL
        </label>
        <input
          id="feedUrl"
          name="feedUrl"
          type="url"
          defaultValue={values.feedUrl}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.feedUrl} />
      </div>

      <div>
        <label htmlFor="homepageUrl" className={labelClass}>
          Homepage URL
        </label>
        <input
          id="homepageUrl"
          name="homepageUrl"
          type="url"
          defaultValue={values.homepageUrl}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.homepageUrl} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="language" className={labelClass}>
            Language
          </label>
          <input
            id="language"
            name="language"
            type="text"
            defaultValue={values.language}
            className={`mt-1 ${inputClass}`}
          />
          <FieldError message={fieldErrors.language} />
        </div>
        <div>
          <label htmlFor="pollInterval" className={labelClass}>
            Poll interval (seconds)
          </label>
          <input
            id="pollInterval"
            name="pollInterval"
            type="number"
            min="1"
            defaultValue={values.pollInterval}
            className={`mt-1 ${inputClass}`}
          />
          <FieldError message={fieldErrors.pollInterval} />
        </div>
      </div>

      <div>
        <label htmlFor="defaultTopicId" className={labelClass}>
          Default Topic
        </label>
        <select
          id="defaultTopicId"
          name="defaultTopicId"
          defaultValue={values.defaultTopicId}
          className={`mt-1 ${inputClass}`}
        >
          <option value="">— none —</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name}
            </option>
          ))}
        </select>
        <FieldError message={fieldErrors.defaultTopicId} />
      </div>

      <div>
        <label htmlFor="sourceConfig" className={labelClass}>
          Adapter config (JSON)
        </label>
        <textarea
          id="sourceConfig"
          name="sourceConfig"
          rows={4}
          defaultValue={values.sourceConfig}
          placeholder={
            '{"owner":"vercel","repo":"next.js","prereleases":"exclude"} — GitHub\n' +
            '{"mode":"top","maxItems":50} — Hacker News. Leave blank for RSS/Atom.'
          }
          className={`mt-1 font-mono text-sm ${inputClass}`}
        />
        <FieldError message={fieldErrors.sourceConfig} />
        <p className="mt-1 text-xs text-gray-500">
          Source-type-specific acquisition settings. GitHub Releases require{' '}
          <code>owner</code>/<code>repo</code>; Hacker News accepts{' '}
          <code>mode</code> (top/best/new/ids). Secrets (e.g. GitHub tokens) are
          NEVER stored here — they are server-only environment configuration.
        </p>
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
