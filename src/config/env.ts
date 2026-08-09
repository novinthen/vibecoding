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
