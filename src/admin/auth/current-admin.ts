import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { appEnv, requireAdminAuthConfig } from '@/config/env';

import { assertCanMutate } from './guard';
import {
  createSessionToken,
  verifySessionToken,
  type AdminSession,
} from './session';

/**
 * Next.js glue for admin sessions (Stage 4).
 *
 * Thin server-only adapter around the framework-free auth cores. Reads/writes
 * the session cookie and performs redirects. The verification/authorization
 * logic itself lives in session.ts / guard.ts and is unit-tested there.
 */

export const ADMIN_SESSION_COOKIE = 'admin_session';
const LOGIN_PATH = '/admin/login';

function cookieSecure(): boolean {
  return appEnv.NODE_ENV === 'production' || appEnv.APP_ENV === 'production';
}

/** Read and verify the current admin session, or null when absent/invalid. */
export async function getCurrentAdmin(): Promise<AdminSession | null> {
  const config = safeConfig();
  if (!config) return null;
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token, config.sessionSecret);
}

/**
 * Require an authenticated admin (any role). Redirects to the login page when
 * there is no valid session. Use in the admin layout and read-only routes.
 */
export async function requireAdmin(): Promise<AdminSession> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect(LOGIN_PATH);
  return admin;
}

/**
 * Require an admin permitted to mutate. Redirects unauthenticated callers to
 * login and throws UnauthorizedError for authenticated-but-forbidden roles
 * (VIEWER). Server actions call this before performing any write.
 */
export async function requireMutatingAdmin(): Promise<AdminSession> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect(LOGIN_PATH);
  return assertCanMutate(admin);
}

/** Issue a session cookie for a freshly authenticated admin. */
export async function establishSession(input: {
  username: string;
  role: AdminSession['role'];
}): Promise<void> {
  const config = requireAdminAuthConfig();
  const token = createSessionToken(input, config.sessionSecret);
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
}

/** Clear the session cookie (logout). */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

function safeConfig(): { sessionSecret: string } | null {
  try {
    return requireAdminAuthConfig();
  } catch {
    return null;
  }
}
