import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { canonicalDefaultLocale } from '@/public/locale';
import { getActivePublication } from '@/public/request';

import './globals.css';

export const metadata: Metadata = {
  title: 'Vibe Coding News Portal',
  description:
    'AI-enriched news and intelligence for the vibe-coding ecosystem: AI coding tools, agents, MCP, models, releases, and developer signals.',
};

/**
 * The root `<html lang>` reflects the active Publication's default locale
 * (multi-publication by design — never a hardcoded locale). Resolution is
 * best-effort: an unresolved/unconfigured host, or any resolution error, falls
 * back to `en` so rendering never depends on it. Localisation-aware routes (a
 * Story served in a non-default locale) additionally mark the rendered locale on
 * their content element and in route metadata.
 */
async function resolveHtmlLang(): Promise<string> {
  try {
    const resolution = await getActivePublication();
    if (resolution.status === 'unresolved') return 'en';
    return canonicalDefaultLocale(resolution.config.locale);
  } catch {
    return 'en';
  }
}

export default async function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const lang = await resolveHtmlLang();
  return (
    <html lang={lang}>
      <body className="min-h-screen bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
