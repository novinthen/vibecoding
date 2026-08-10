'use client';

import { useActionState } from 'react';

import {
  buttonClass,
  FormError,
  inputClass,
  labelClass,
} from '../_components/ui';
import type { ActionState } from '../_lib/action-result';

import { loginAction } from './actions';

const initialState: ActionState = {};

/** Admin login form. Client component so it can surface the action's error. */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    loginAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <div>
        <label htmlFor="username" className={labelClass}>
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <div>
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
