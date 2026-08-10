/** Shown on read pages when no database is configured for the deployment. */
export function DatabaseUnavailable() {
  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      No database is configured for this deployment. Set{' '}
      <code className="font-mono">DATABASE_URL</code> to inspect and operate the
      ingestion system.
    </div>
  );
}

/** A neutral empty-state row/message for tables and lists. */
export function EmptyState({ message }: { readonly message: string }) {
  return (
    <p className="px-1 py-6 text-center text-sm text-neutral-500">{message}</p>
  );
}
