'use server';

import { redirect } from 'next/navigation';

import { clearSession } from '@/admin/auth/current-admin';

/** Clear the session cookie and return to the login page. */
export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect('/admin/login');
}
