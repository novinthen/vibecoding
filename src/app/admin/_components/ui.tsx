import Link from 'next/link';
import type { ReactNode } from 'react';

import type { HealthStatus } from '@/domain/enums';

/**
 * Small presentational helpers for the admin surface.
 *
 * Restrained, functional building blocks (Stage 4 prioritizes operational
 * usefulness over polish). All are server-safe — no client hooks — and render
 * their children as escaped text/JSX by default; none use dangerouslySetInnerHTML.
 */

export function PageHeader({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-neutral-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex gap-2">{action}</div> : null}
    </div>
  );
}

export function Card({
  title,
  children,
}: {
  readonly title?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {title ? (
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  tone = 'default',
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'bad'
          ? 'text-red-600 dark:text-red-400'
          : 'text-neutral-900 dark:text-neutral-100';
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

const HEALTH_TONE: Record<HealthStatus, string> = {
  HEALTHY:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  DEGRADED:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  FAILING: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  DISABLED:
    'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  UNKNOWN:
    'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
};

export function HealthBadge({ status }: { readonly status: HealthStatus }) {
  return <Badge className={HEALTH_TONE[status]}>{status}</Badge>;
}

const FETCH_STATUS_TONE: Record<string, string> = {
  SUCCESS:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  PARTIAL:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  SKIPPED: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  STARTED:
    'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
};

export function FetchStatusBadge({ status }: { readonly status: string }) {
  const tone =
    FETCH_STATUS_TONE[status] ??
    'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400';
  return <Badge className={tone}>{status}</Badge>;
}

export function Badge({
  children,
  className = 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

export function FieldError({ message }: { readonly message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{message}</p>
  );
}

export function FormError({ message }: { readonly message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
    >
      {message}
    </div>
  );
}

/** Buttons/links share a compact, restrained style. */
export const buttonClass =
  'inline-flex items-center rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300';
export const secondaryButtonClass =
  'inline-flex items-center rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800';
export const inputClass =
  'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100';
export const labelClass =
  'block text-sm font-medium text-neutral-700 dark:text-neutral-300';

export function AdminLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="font-medium text-sky-700 hover:underline dark:text-sky-400"
    >
      {children}
    </Link>
  );
}

/** Format an ISO timestamp for compact display; '—' when absent. */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, 'Z');
}
