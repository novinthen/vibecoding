import { redirect } from 'next/navigation';

import { getCurrentAdmin } from '@/admin/auth/current-admin';
import { isAdminConfigured } from '@/config/env';

import { LoginForm } from './login-form';

export const metadata = {
  title: 'Admin sign in — Vibe Coding News Portal',
};

// Always dynamic: reads the session cookie.
export const dynamic = 'force-dynamic';

export default async function AdminLoginPage() {
  // If already signed in, skip the form.
  const admin = await getCurrentAdmin();
  if (admin) redirect('/admin');

  const configured = isAdminConfigured();

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
          Vibe Coding News Portal
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Admin sign in</h1>
      </div>
      {configured ? (
        <LoginForm />
      ) : (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          The admin surface is not configured. Set{' '}
          <code className="font-mono">ADMIN_SESSION_SECRET</code> and{' '}
          <code className="font-mono">ADMIN_USERS</code>. See{' '}
          <code className="font-mono">docs/ADMIN.md</code>.
        </p>
      )}
    </main>
  );
}
