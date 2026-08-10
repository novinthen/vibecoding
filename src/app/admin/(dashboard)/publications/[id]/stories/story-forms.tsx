'use client';

import { useActionState } from 'react';

import { TRANSLATION_SOURCES } from '@/domain/enums';

import {
  buttonClass,
  FieldError,
  FormError,
  inputClass,
  labelClass,
} from '../../../../_components/ui';
import type { ActionState } from '../../../../_lib/action-result';

type FormAction = (
  state: ActionState,
  formData: FormData,
) => Promise<ActionState>;

export interface StoryOption {
  id: string;
  label: string;
}

export interface PublicationStoryDefaults {
  slug?: string;
  headline?: string;
  publishedSummary?: string;
  publishedWhyItMatters?: string;
  featured?: boolean;
  editorialPriority?: number;
}

/**
 * Attach or edit a PublicationStory. On attach, a real canonical Story must be
 * chosen from the select (no fake Stories are ever invented). On edit, the
 * canonical Story link is immutable and not shown. Editing here changes only the
 * per-Publication presentation — never canonical Story facts.
 */
export function PublicationStoryForm({
  action,
  mode,
  stories,
  defaults = {},
}: {
  readonly action: FormAction;
  readonly mode: 'create' | 'edit';
  readonly stories?: readonly StoryOption[];
  readonly defaults?: PublicationStoryDefaults;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      {state.ok ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>
      ) : null}

      {mode === 'create' ? (
        <div>
          <label htmlFor="storyId" className={labelClass}>
            Canonical Story
          </label>
          <select
            id="storyId"
            name="storyId"
            required
            defaultValue=""
            className={`mt-1 ${inputClass}`}
          >
            <option value="" disabled>
              Select a Story…
            </option>
            {(stories ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.storyId} />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="slug" className={labelClass}>
            Publication slug
          </label>
          <input
            id="slug"
            name="slug"
            type="text"
            required
            defaultValue={defaults.slug ?? ''}
            className={`mt-1 ${inputClass}`}
          />
          <FieldError message={fieldErrors.slug} />
        </div>
        <div>
          <label htmlFor="editorialPriority" className={labelClass}>
            Editorial priority
          </label>
          <input
            id="editorialPriority"
            name="editorialPriority"
            type="number"
            defaultValue={defaults.editorialPriority ?? 0}
            className={`mt-1 ${inputClass}`}
          />
          <FieldError message={fieldErrors.editorialPriority} />
        </div>
      </div>

      <div>
        <label htmlFor="headline" className={labelClass}>
          Headline (default publication copy)
        </label>
        <input
          id="headline"
          name="headline"
          type="text"
          defaultValue={defaults.headline ?? ''}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.headline} />
      </div>

      <div>
        <label htmlFor="publishedSummary" className={labelClass}>
          Published summary
        </label>
        <textarea
          id="publishedSummary"
          name="publishedSummary"
          rows={3}
          defaultValue={defaults.publishedSummary ?? ''}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.publishedSummary} />
      </div>

      <div>
        <label htmlFor="publishedWhyItMatters" className={labelClass}>
          Published “why it matters”
        </label>
        <textarea
          id="publishedWhyItMatters"
          name="publishedWhyItMatters"
          rows={3}
          defaultValue={defaults.publishedWhyItMatters ?? ''}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.publishedWhyItMatters} />
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        <input
          type="checkbox"
          name="featured"
          value="true"
          defaultChecked={defaults.featured ?? false}
        />
        Featured
      </label>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : mode === 'create' ? 'Attach Story' : 'Save'}
      </button>
    </form>
  );
}

export interface LocalizationDefaults {
  locale?: string;
  headline?: string;
  summary?: string;
  whyItMatters?: string;
  translationSource?: string;
  modelProvider?: string;
  modelName?: string;
}

/**
 * Create or edit a StoryLocalization. Stage 5B supports manual/editorial
 * localisation and import of already-translated text with provenance — no
 * automated translation runs here. Locale is the localisation's identity, so it
 * is editable only on create.
 */
export function LocalizationForm({
  action,
  mode,
  defaults = {},
}: {
  readonly action: FormAction;
  readonly mode: 'create' | 'edit';
  readonly defaults?: LocalizationDefaults;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state.error} />
      {state.ok ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="locale" className={labelClass}>
            Locale {mode === 'edit' ? '(immutable)' : ''}
          </label>
          <input
            id="locale"
            name="locale"
            type="text"
            required={mode === 'create'}
            defaultValue={defaults.locale ?? ''}
            readOnly={mode === 'edit'}
            placeholder="ms, en-US, zh-Hans"
            className={`mt-1 ${inputClass} ${mode === 'edit' ? 'opacity-60' : ''}`}
          />
          <FieldError message={fieldErrors.locale} />
        </div>
        <div>
          <label htmlFor="translationSource" className={labelClass}>
            Translation source
          </label>
          <select
            id="translationSource"
            name="translationSource"
            defaultValue={defaults.translationSource ?? ''}
            className={`mt-1 ${inputClass}`}
          >
            <option value="">— unspecified —</option>
            {TRANSLATION_SOURCES.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.translationSource} />
        </div>
      </div>

      <div>
        <label htmlFor="loc-headline" className={labelClass}>
          Localized headline
        </label>
        <input
          id="loc-headline"
          name="headline"
          type="text"
          defaultValue={defaults.headline ?? ''}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.headline} />
      </div>

      <div>
        <label htmlFor="loc-summary" className={labelClass}>
          Localized summary
        </label>
        <textarea
          id="loc-summary"
          name="summary"
          rows={3}
          defaultValue={defaults.summary ?? ''}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.summary} />
      </div>

      <div>
        <label htmlFor="loc-why" className={labelClass}>
          Localized “why it matters”
        </label>
        <textarea
          id="loc-why"
          name="whyItMatters"
          rows={3}
          defaultValue={defaults.whyItMatters ?? ''}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.whyItMatters} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="modelProvider" className={labelClass}>
            Model provider (optional)
          </label>
          <input
            id="modelProvider"
            name="modelProvider"
            type="text"
            defaultValue={defaults.modelProvider ?? ''}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="modelName" className={labelClass}>
            Model name (optional)
          </label>
          <input
            id="modelName"
            name="modelName"
            type="text"
            defaultValue={defaults.modelName ?? ''}
            className={`mt-1 ${inputClass}`}
          />
        </div>
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending
          ? 'Saving…'
          : mode === 'create'
            ? 'Add localisation'
            : 'Save localisation'}
      </button>
    </form>
  );
}
