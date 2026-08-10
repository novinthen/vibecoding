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
  /**
   * Secret used to sign admin session cookies (Stage 4). A server-only secret,
   * never exposed to the browser and never committed. Optional so the app still
   * builds without an admin configured; the admin auth layer validates its
   * presence explicitly at call time via `requireAdminAuthConfig()`. Must be
   * long/high-entropy in production (enforced there by the same check).
   */
  ADMIN_SESSION_SECRET: z.string().min(1).optional(),
  /**
   * Admin account roster (Stage 4) as a JSON array of
   * `{ username, passwordHash, role? }`. Passwords are stored ONLY as scrypt
   * hashes (see `scripts/admin-hash.ts`); plaintext credentials are never
   * accepted here. Optional at build/boot; the admin auth layer parses and
   * validates the shape at call time. Never commit a real roster.
   */
  ADMIN_USERS: z.string().min(1).optional(),
  /**
   * AI enrichment provider selection (Stage 6). `fake` uses the deterministic
   * in-memory provider (tests, local smoke); `anthropic` uses the live Messages
   * API adapter. Unset means AI is not configured — enrichment is OPTIONAL and
   * the rest of the app (ingestion, admin, public) works unchanged.
   */
  AI_PROVIDER: z.enum(['anthropic', 'fake']).optional(),
  /**
   * Server-only AI API key. Never exposed to the browser and never embedded in a
   * prompt or error message. Required (validated at call time) when
   * AI_PROVIDER=anthropic.
   */
  AI_API_KEY: z.string().min(1).optional(),
  /** Model identifier passed to the provider (e.g. a claude-* model id). */
  AI_MODEL: z.string().min(1).optional(),
  /** Optional override for the provider base URL (compatible endpoints/proxies). */
  AI_BASE_URL: z.string().url().optional(),
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

/** Admin auth configuration resolved from the environment. */
export interface AdminAuthConfig {
  sessionSecret: string;
  usersJson: string;
}

/**
 * Resolve the admin auth configuration (Stage 4) or throw a clear error when
 * the admin surface is not configured. Kept as a function so that non-admin
 * code paths (public pages, build) never require these secrets to be present.
 */
export function requireAdminAuthConfig(env: AppEnv = appEnv): AdminAuthConfig {
  if (!env.ADMIN_SESSION_SECRET || !env.ADMIN_USERS) {
    throw new Error(
      'Admin surface is not configured. Set ADMIN_SESSION_SECRET and ' +
        'ADMIN_USERS in your environment. See .env.example and ' +
        'docs/ADMIN.md.',
    );
  }
  // In production a short/low-entropy signing secret would let anyone forge a
  // session cookie; refuse to run rather than fail open.
  if (env.NODE_ENV === 'production' && env.ADMIN_SESSION_SECRET.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET must be at least 32 characters in production.',
    );
  }
  return {
    sessionSecret: env.ADMIN_SESSION_SECRET,
    usersJson: env.ADMIN_USERS,
  };
}

/** Whether the admin surface is configured, without throwing. */
export function isAdminConfigured(env: AppEnv = appEnv): boolean {
  return Boolean(env.ADMIN_SESSION_SECRET && env.ADMIN_USERS);
}

/** Resolved AI provider configuration (Stage 6). */
export interface AiProviderConfig {
  provider: 'anthropic' | 'fake';
  /** Present for providers that require it (anthropic); absent for fake. */
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

/** Whether an AI enrichment provider is configured, without throwing. */
export function isAiConfigured(env: AppEnv = appEnv): boolean {
  return Boolean(env.AI_PROVIDER);
}

/**
 * Resolve the AI provider configuration or throw a clear error. AI is optional:
 * only enrichment code paths call this, so ingestion, admin, and public rendering
 * never require AI to be configured. The API key is validated for providers that
 * need it and is never surfaced beyond this server-only boundary.
 */
export function requireAiConfig(env: AppEnv = appEnv): AiProviderConfig {
  const provider = env.AI_PROVIDER;
  if (!provider) {
    throw new Error(
      'AI provider is not configured. Set AI_PROVIDER (and, for anthropic, ' +
        'AI_API_KEY and AI_MODEL). See .env.example and docs/ARCHITECTURE.MD.',
    );
  }
  if (provider === 'fake') {
    return { provider, model: env.AI_MODEL ?? 'fake-1' };
  }
  // anthropic
  if (!env.AI_API_KEY) {
    throw new Error('AI_API_KEY is required when AI_PROVIDER=anthropic.');
  }
  if (!env.AI_MODEL) {
    throw new Error('AI_MODEL is required when AI_PROVIDER=anthropic.');
  }
  return {
    provider,
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL,
    baseUrl: env.AI_BASE_URL,
  };
}
