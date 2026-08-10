import Link from 'next/link';

/** Public 404, rendered inside the portal chrome. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-12 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-sky-700 dark:text-sky-400">
        404
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Not found</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        That page doesn&rsquo;t exist, or the content isn&rsquo;t available.
      </p>
      <div className="mt-6 flex justify-center gap-3 text-sm">
        <Link
          href="/"
          className="rounded-md bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Home
        </Link>
        <Link
          href="/latest"
          className="rounded-md border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Latest
        </Link>
      </div>
    </div>
  );
}
