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

/** Values used to pre-fill the edit form (all optional for create). */
export interface PublicationFormDefaults {
  name?: string;
  slug?: string;
  defaultLocale?: string;
  timezone?: string;
  brandingName?: string;
  tagline?: string;
  seoDescription?: string;
  positioning?: string;
  audience?: string;
}

type FormAction = (
  state: ActionState,
  formData: FormData,
) => Promise<ActionState>;

/**
 * Create/edit form for a Publication. Server-side validation is authoritative;
 * this only surfaces the returned field errors. On create, the slug field is
 * shown (optional; derived from the name when blank); on edit it is immutable
 * and rendered read-only.
 */
export function PublicationForm({
  action,
  mode,
  defaults = {},
}: {
  readonly action: FormAction;
  readonly mode: 'create' | 'edit';
  readonly defaults?: PublicationFormDefaults;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    {} as ActionState,
  );
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className={labelClass}>
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={defaults.name ?? ''}
            className={`mt-1 ${inputClass}`}
          />
          <FieldError message={fieldErrors.name} />
        </div>

        <div>
          <label htmlFor="slug" className={labelClass}>
            Slug {mode === 'create' ? '(optional)' : '(immutable)'}
          </label>
          <input
            id="slug"
            name="slug"
            type="text"
            defaultValue={defaults.slug ?? ''}
            readOnly={mode === 'edit'}
            placeholder={mode === 'create' ? 'derived from name' : undefined}
            className={`mt-1 ${inputClass} ${mode === 'edit' ? 'opacity-60' : ''}`}
          />
          <FieldError message={fieldErrors.slug} />
        </div>

        <div>
          <label htmlFor="defaultLocale" className={labelClass}>
            Default locale
          </label>
          <input
            id="defaultLocale"
            name="defaultLocale"
            type="text"
            required
            defaultValue={defaults.defaultLocale ?? 'en'}
            placeholder="en, ms, en-US"
            className={`mt-1 ${inputClass}`}
          />
          <FieldError message={fieldErrors.defaultLocale} />
        </div>

        <div>
          <label htmlFor="timezone" className={labelClass}>
            Time zone
          </label>
          <input
            id="timezone"
            name="timezone"
            type="text"
            required
            defaultValue={defaults.timezone ?? 'UTC'}
            placeholder="UTC, Asia/Kuala_Lumpur"
            className={`mt-1 ${inputClass}`}
          />
          <FieldError message={fieldErrors.timezone} />
        </div>

        <div>
          <label htmlFor="brandingName" className={labelClass}>
            Branding display name (optional)
          </label>
          <input
            id="brandingName"
            name="brandingName"
            type="text"
            defaultValue={defaults.brandingName ?? ''}
            className={`mt-1 ${inputClass}`}
          />
          <FieldError message={fieldErrors.brandingName} />
        </div>

        <div>
          <label htmlFor="tagline" className={labelClass}>
            Tagline (optional)
          </label>
          <input
            id="tagline"
            name="tagline"
            type="text"
            defaultValue={defaults.tagline ?? ''}
            className={`mt-1 ${inputClass}`}
          />
          <FieldError message={fieldErrors.tagline} />
        </div>
      </div>

      <div>
        <label htmlFor="seoDescription" className={labelClass}>
          SEO description (optional)
        </label>
        <textarea
          id="seoDescription"
          name="seoDescription"
          rows={2}
          defaultValue={defaults.seoDescription ?? ''}
          className={`mt-1 ${inputClass}`}
        />
        <FieldError message={fieldErrors.seoDescription} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="positioning" className={labelClass}>
            Editorial positioning (optional)
          </label>
          <textarea
            id="positioning"
            name="positioning"
            rows={2}
            defaultValue={defaults.positioning ?? ''}
            className={`mt-1 ${inputClass}`}
          />
          <FieldError message={fieldErrors.positioning} />
        </div>
        <div>
          <label htmlFor="audience" className={labelClass}>
            Audience (optional)
          </label>
          <textarea
            id="audience"
            name="audience"
            rows={2}
            defaultValue={defaults.audience ?? ''}
            className={`mt-1 ${inputClass}`}
          />
          <FieldError message={fieldErrors.audience} />
        </div>
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending
          ? 'Saving…'
          : mode === 'create'
            ? 'Create Publication'
            : 'Save changes'}
      </button>
    </form>
  );
}
