import { z } from 'zod';

import type { SourceType } from '@/domain/enums';

const emptyConfig = z.object({}).strict();

/**
 * A GitHub owner/repo path segment. The character class already forbids `/`
 * (path traversal / injection into the fixed api.github.com path), but `.` and
 * `..` survive `encodeURIComponent`, so they are rejected explicitly — the
 * acquirer builds `/repos/{owner}/{repo}/releases` from these and must never be
 * steered off that fixed path.
 */
const githubPathSegment = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/)
  .refine((value) => value !== '.' && value !== '..', {
    message: 'Must not be "." or "..".',
  });

const githubConfig = z
  .object({
    owner: githubPathSegment,
    repo: githubPathSegment,
    prereleases: z.enum(['exclude', 'include', 'only']).default('exclude'),
    perPage: z.number().int().min(1).max(100).default(30),
    maxPages: z.number().int().min(1).max(5).default(1),
  })
  .strict();

const hackerNewsConfig = z
  .object({
    mode: z.enum(['top', 'best', 'new', 'ids']).default('top'),
    maxItems: z.number().int().min(1).max(200).default(50),
    ids: z.array(z.number().int().positive()).max(200).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'ids' && value.ids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ids'],
        message: 'At least one item ID is required when mode is ids.',
      });
    }
    if (value.mode !== 'ids' && value.ids.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ids'],
        message: 'Item IDs are only allowed when mode is ids.',
      });
    }
  });

export const sourceConfigSchema = z.union([
  emptyConfig,
  githubConfig,
  hackerNewsConfig,
]);

export type GithubSourceConfig = z.infer<typeof githubConfig>;
export type HackerNewsSourceConfig = z.infer<typeof hackerNewsConfig>;
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export function parseSourceConfig(
  sourceType: SourceType,
  input: unknown,
): SourceConfig {
  const value = input ?? {};
  if (sourceType === 'GITHUB') return githubConfig.parse(value);
  if (sourceType === 'HACKER_NEWS') return hackerNewsConfig.parse(value);
  return emptyConfig.parse(value);
}

export function sourceConfigForStorage(
  sourceType: SourceType,
  input: unknown,
): Record<string, unknown> {
  return parseSourceConfig(sourceType, input) as Record<string, unknown>;
}

export function sourceConfigSummary(
  sourceType: SourceType,
  input: unknown,
): Record<string, unknown> {
  const config = parseSourceConfig(sourceType, input);
  if (sourceType === 'GITHUB') {
    const value = config as GithubSourceConfig;
    return {
      owner: value.owner,
      repo: value.repo,
      prereleases: value.prereleases,
      perPage: value.perPage,
      maxPages: value.maxPages,
    };
  }
  if (sourceType === 'HACKER_NEWS') {
    const value = config as HackerNewsSourceConfig;
    return {
      mode: value.mode,
      maxItems: value.maxItems,
      idsCount: value.ids.length,
    };
  }
  return {};
}
