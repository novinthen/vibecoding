'use server';

import { redirect } from 'next/navigation';

import { establishSession } from '@/admin/auth/current-admin';
import { authenticate, loadRoster } from '@/admin/auth/users';
import { loginSchema } from '@/admin/validation';
import { isAdminConfigured } from '@/config/env';

import { toActionState, type ActionState } from '../_lib/action-result';

/**
 * Login server action.
 *
 * Server-side credential verification against the env-configured roster. On
 * success an httpOnly, signed session cookie is issued and the admin is
 * redirected into the dashboard. Failures return a single generic message so the
 * response never reveals whether a username exists.
 */
export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!isAdminConfigured()) {
    return { error: 'The admin surface is not configured on this deployment.' };
  }

  const parsed = loginSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'Enter a username and password.' };
  }

  let authed: { username: string; role: 'ADMIN' | 'EDITOR' | 'VIEWER' } | null;
  try {
    const roster = loadRoster();
    authed = authenticate(roster, parsed.data.username, parsed.data.password);
  } catch (error) {
    return toActionState(error);
  }
  if (!authed) {
    return { error: 'Invalid username or password.' };
  }

  await establishSession(authed);
  // redirect throws NEXT_REDIRECT and must run outside any try/catch.
  redirect('/admin');
}
