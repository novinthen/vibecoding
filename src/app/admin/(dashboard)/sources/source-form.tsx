'use client';

import { useActionState, useState } from 'react';

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
  // Source-type-specific adapter config (Stage 9B).
  cfgOwner: string;
  cfgRepo: string;
  cfgPrereleases: string;
  cfgPerPage: string;
  cfgMaxPages: string;
  cfgMode: string;
  cfgMaxItems: string;
  cfgIds: string;
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
  cfgOwner: '',
  cfgRepo: '',
  cfgPrereleases: 'exclude',
  cfgPerPage: '',
  cfgMaxPages: '',
  cfgMode: 'top',
  cfgMaxItems: '',
  cfgIds: '',
};

/**
 * Create/edit form for a Source. In edit mode the slug and type are shown
 * read-only (they are immutable identity/adapter selectors); the type is still
 * submitted as a hidden field so the server action can assemble the correct
 * adapter config. Source-type-specific config is rendered as discrete,
 * operator-friendly fields (no raw JSON); server-side Zod validation remains
 * authoritative. Secrets (e.g. a GitHub token) are NEVER entered here — a token
 * is server-only environment configuration.
 */
export function SourceForm({
  action,
  topics,
  mode,
  initial,
  submitLabel,
  githubTokenConfigured = false,
}: {
  readonly action: (
    prev: ActionState,
    formData: FormData,
  ) => Promise<ActionState>;
  readonly topics: readonly TopicOption[];
  readonly mode: 'create' | 'edit';
  readonly initial?: Partial<SourceFormValues>;
  readonly submitLabel: string;
  readonly githubTokenConfigured?: boolean;
}) {
  const values = { ...EMPTY, ...initial };
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );
  const fieldErrors = state.fieldErrors ?? {};

  // Track the selected type/mode so the right config fields render live.
  const [sourceType, setSourceType] = useState(values.sourceType);
  const [hnMode, setHnMode] = useState(values.cfgMode);

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
            <>
              <input
                id="sourceType"
                type="text"
                value={values.sourceType}
                readOnly
                className={`mt-1 ${inputClass} opacity-60`}
              />
              {/* Immutable, but submitted so the action assembles the right config. */}
              <input
                type="hidden"
                name="sourceType"
                value={values.sourceType}
              />
            </>
          ) : (
            <select
              id="sourceType"
              name="sourceType"
              defaultValue={values.sourceType}
              onChange={(e) => setSourceType(e.target.value)}
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

      {sourceType === 'GITHUB' && (
        <fieldset className="space-y-4 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
          <legend className="px-1 text-sm font-semibold">
            GitHub Releases configuration
          </legend>
          {githubTokenConfigured && (
            <p className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              GitHub authentication configured (server-side token). The token
              value is never shown or stored on the Source.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="cfg_owner" className={labelClass}>
                Owner
              </label>
              <input
                id="cfg_owner"
                name="cfg_owner"
                type="text"
                defaultValue={values.cfgOwner}
                placeholder="vercel"
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div>
              <label htmlFor="cfg_repo" className={labelClass}>
                Repository
              </label>
              <input
                id="cfg_repo"
                name="cfg_repo"
                type="text"
                defaultValue={values.cfgRepo}
                placeholder="next.js"
                className={`mt-1 ${inputClass}`}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="cfg_prereleases" className={labelClass}>
                Prereleases
              </label>
              <select
                id="cfg_prereleases"
                name="cfg_prereleases"
                defaultValue={values.cfgPrereleases}
                className={`mt-1 ${inputClass}`}
              >
                <option value="exclude">exclude</option>
                <option value="include">include</option>
                <option value="only">only</option>
              </select>
            </div>
            <div>
              <label htmlFor="cfg_perPage" className={labelClass}>
                Per page (1–100)
              </label>
              <input
                id="cfg_perPage"
                name="cfg_perPage"
                type="number"
                min="1"
                max="100"
                defaultValue={values.cfgPerPage}
                placeholder="30"
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div>
              <label htmlFor="cfg_maxPages" className={labelClass}>
                Max pages (1–5)
              </label>
              <input
                id="cfg_maxPages"
                name="cfg_maxPages"
                type="number"
                min="1"
                max="5"
                defaultValue={values.cfgMaxPages}
                placeholder="1"
                className={`mt-1 ${inputClass}`}
              />
            </div>
          </div>
          <FieldError message={fieldErrors.sourceConfig} />
        </fieldset>
      )}

      {sourceType === 'HACKER_NEWS' && (
        <fieldset className="space-y-4 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
          <legend className="px-1 text-sm font-semibold">
            Hacker News configuration
          </legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="cfg_mode" className={labelClass}>
                Mode
              </label>
              <select
                id="cfg_mode"
                name="cfg_mode"
                defaultValue={values.cfgMode}
                onChange={(e) => setHnMode(e.target.value)}
                className={`mt-1 ${inputClass}`}
              >
                <option value="top">top</option>
                <option value="best">best</option>
                <option value="new">new</option>
                <option value="ids">ids</option>
              </select>
            </div>
            <div>
              <label htmlFor="cfg_maxItems" className={labelClass}>
                Max items (1–200)
              </label>
              <input
                id="cfg_maxItems"
                name="cfg_maxItems"
                type="number"
                min="1"
                max="200"
                defaultValue={values.cfgMaxItems}
                placeholder="50"
                className={`mt-1 ${inputClass}`}
              />
            </div>
          </div>
          {hnMode === 'ids' && (
            <div>
              <label htmlFor="cfg_ids" className={labelClass}>
                Item IDs (comma or space separated)
              </label>
              <textarea
                id="cfg_ids"
                name="cfg_ids"
                rows={2}
                defaultValue={values.cfgIds}
                placeholder="38001234, 38005678"
                className={`mt-1 font-mono text-sm ${inputClass}`}
              />
            </div>
          )}
          <FieldError message={fieldErrors.sourceConfig} />
        </fieldset>
      )}

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
