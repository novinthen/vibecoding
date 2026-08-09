import { appEnv } from '@/config/env';

/**
 * Stage 2A foundation placeholder.
 *
 * This is intentionally NOT the public product homepage. The real
 * multi-publication public experience is a later roadmap stage. This route
 * only proves the App Router, TypeScript, Tailwind, and environment-validation
 * seams are wired together correctly.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-neutral-500">
        Vibe Coding News Portal
      </p>
      <h1 className="text-3xl font-semibold sm:text-4xl">
        Stage 2A — Project foundation
      </h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        The application scaffold is running. Ingestion, AI enrichment,
        clustering, ranking, and the public UI are deliberately not implemented
        yet. See <code className="font-mono">docs/CURRENT_STAGE.md</code> for
        the approved scope.
      </p>
      <p className="text-sm text-neutral-500">
        Environment: <span className="font-mono">{appEnv.NODE_ENV}</span>
      </p>
    </main>
  );
}
