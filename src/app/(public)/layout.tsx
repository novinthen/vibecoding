import Link from 'next/link';
import type { ReactNode } from 'react';

import { defaultPublicationConfig } from '@/public/publication';
import { getActivePublication } from '@/public/request';

/**
 * Public portal shell: a restrained header with primary navigation and inline
 * search, and a footer stating the attribution/aggregation philosophy. The site
 * name is publication-aware (resolved from the request hostname); nothing here
 * hardcodes a brand or domain.
 */

const NAV = [
  { href: '/latest', label: 'Latest' },
  { href: '/topic', label: 'Topics' },
  { href: '/tool', label: 'Tools' },
  { href: '/sources', label: 'Sources' },
  { href: '/about', label: 'About' },
];

export default async function PublicLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  // The layout wraps every public page, including the 404 shown for an
  // unresolved production host. In that case the page itself fails closed
  // (notFound); the surrounding chrome only needs a neutral display name (the
  // env app name, never a host-derived value), so nothing is "served" here.
  const resolution = await getActivePublication();
  const config =
    resolution.status === 'unresolved'
      ? defaultPublicationConfig()
      : resolution.config;

  return (
    <div className="flex min-h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-lg font-bold tracking-tight">
              {config.name}
            </Link>
          </div>
          <div className="flex flex-1 items-center gap-4 sm:justify-end">
            <nav className="flex flex-wrap items-center gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-2 py-1 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <form
              action="/search"
              method="get"
              role="search"
              className="shrink-0"
            >
              <input
                type="search"
                name="q"
                placeholder="Search…"
                aria-label="Search articles"
                className="w-32 rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none sm:w-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>

      <footer className="border-t border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-neutral-500">
          <p className="max-w-2xl">
            {config.name} is a discovery and intelligence layer for the
            vibe-coding ecosystem. It links to original reporting and preserves
            each source&rsquo;s name, publication time, and canonical URL — it
            is not a republishing engine.
          </p>
          <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Link href="/about" className="hover:underline">
              About &amp; sourcing
            </Link>
            <Link href="/sources" className="hover:underline">
              Sources
            </Link>
            <Link href="/latest" className="hover:underline">
              Latest
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
