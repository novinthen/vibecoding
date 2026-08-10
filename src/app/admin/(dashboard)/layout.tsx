import Link from 'next/link';
import type { ReactNode } from 'react';

import { requireAdmin } from '@/admin/auth/current-admin';

import { Badge, secondaryButtonClass } from '../_components/ui';

import { logoutAction } from './actions';

export const metadata = {
  title: 'Admin — Vibe Coding News Portal',
};

// The whole dashboard depends on the request's session cookie.
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/sources', label: 'Sources' },
  { href: '/admin/fetches', label: 'Fetches' },
  { href: '/admin/articles', label: 'Articles' },
  { href: '/admin/stories', label: 'Stories' },
  { href: '/admin/topics', label: 'Topics' },
  { href: '/admin/publications', label: 'Publications' },
];

/**
 * Authenticated admin shell.
 *
 * The gate: requireAdmin() redirects unauthenticated requests to the login page.
 * This is a coarse, navigation-level check — every mutation independently
 * re-verifies authorization in its server action, so the UI never *is* the
 * security boundary.
 */
export default async function DashboardLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm font-semibold">
              Vibe Admin
            </Link>
            <nav className="flex flex-wrap gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-neutral-500">{admin.username}</span>
            <Badge>{admin.role}</Badge>
            <form action={logoutAction}>
              <button type="submit" className={secondaryButtonClass}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
