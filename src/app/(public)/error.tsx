'use client';

import Link from 'next/link';

/**
 * Public error boundary (Stage 10).
 *
 * Renders a friendly, branded fallback for an unexpected server/render error
 * inside the portal chrome. It deliberately shows NO internal detail (no message,
 * stack, or digest) to the visitor — Next.js already strips error messages from
 * the client in production, and this boundary keeps the visible surface to a
 * generic apology plus safe navigation and a retry. The error is still reported
 * to the platform's server logs by Next.js.
 */
export default function PublicError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-12 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-sky-700 dark:text-sky-400">
        Error
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        We hit an unexpected problem loading this page. Please try again.
      </p>
      <div className="mt-6 flex justify-center gap-3 text-sm">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
