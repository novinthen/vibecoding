import { z } from 'zod';

/**
 * Runtime environment validation.
 *
 * Treat process.env as untrusted input (see docs/ARCHITECTURE.md security
 * boundaries). Every environment variable the application relies on must be
 * declared and validated here so misconfiguration fails loudly and early
 * rather than surfacing as a confusing runtime error later.
 *
 * Stage 2A has no database, AI provider, or ingestion sources, so no secret is
 * *required* yet. The variables below are declared with safe defaults to
 * establish the validation seam. As later stages introduce real dependencies
 * (Supabase, AI providers, etc.), add them here and tighten them from optional
 * to required.
 */

const nodeEnvSchema = z
  .enum(['development', 'test', 'production'])
  .default('development');

/**
 * Server-only environment. Never import this into client components; values
 * here may hold secrets in future stages.
 */
const serverSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  /**
   * Deployment target. Distinct from NODE_ENV: a preview deployment still runs
   * a production build. Kept optional in Stage 2A.
   */
  APP_ENV: z.enum(['local', 'preview', 'production']).default('local'),
  /**
   * PostgreSQL / Supabase connection string used by the data-access layer,
   * migrations, and seeds (Stage 2B). Optional so the application still builds
   * and boots without a database configured; database operations validate its
   * presence explicitly at call time via `requireDatabaseUrl()`.
   */
  DATABASE_URL: z.string().url().optional(),
  /**
   * Optional direct (non-pooled) connection string. Supabase exposes a pooled
   * URL for the app and a direct URL better suited to migrations. When unset,
   * migrations fall back to DATABASE_URL.
   */
  DIRECT_URL: z.string().url().optional(),
});

/**
 * Client-exposed environment. Only `NEXT_PUBLIC_`-prefixed variables may live
 * here, because Next.js inlines them into the browser bundle.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('Vibe Coding News Portal'),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;
export type AppEnv = ServerEnv & ClientEnv;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Parse and validate the given environment record. Exported so tests can
 * exercise the validation logic against controlled inputs without mutating the
 * real process environment.
 */
export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const server = serverSchema.safeParse(source);
  const client = clientSchema.safeParse(source);

  if (!server.success || !client.success) {
    const details = [
      server.success ? null : formatIssues(server.error),
      client.success ? null : formatIssues(client.error),
    ]
      .filter(Boolean)
      .join('\n');

    throw new Error(
      `Invalid environment variables:\n${details}\n\n` +
        'Check your .env file against .env.example.',
    );
  }

  return { ...server.data, ...client.data };
}

/**
 * The validated environment for the running process. Import this instead of
 * reading process.env directly so all access is typed and validated.
 */
export const appEnv: AppEnv = parseEnv(process.env);

/**
 * Resolve the connection string for migrations (prefers DIRECT_URL) or throw a
 * clear error when no database is configured. Kept as a function so that code
 * paths not touching the database never require DATABASE_URL to be present.
 */
export function requireMigrationUrl(env: AppEnv = appEnv): string {
  const url = env.DIRECT_URL ?? env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'No database connection string configured. Set DATABASE_URL (and ' +
        'optionally DIRECT_URL) in your environment. See .env.example.',
    );
  }
  return url;
}

/**
 * Resolve the runtime application connection string or throw. Used by the
 * data-access layer.
 */
export function requireDatabaseUrl(env: AppEnv = appEnv): string {
  if (!env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not configured. Set it in your environment. See ' +
        '.env.example.',
    );
  }
  return env.DATABASE_URL;
}
