import { resolveGithubToken } from '@/config/env';
import type { SourceRow } from '@/domain/types';

import type { NormalizedItem } from '../adapters/types';
import { IngestError } from '../http/errors';
import type { FeedFetchOptions } from '../http/fetcher';
import { parseSourceConfig, type GithubSourceConfig } from '../source-config';

import type {
  AcquisitionContext,
  AcquisitionResult,
  SourceAcquirer,
} from './types';

/**
 * GitHub Releases acquirer (Stage 9B).
 *
 * Ingests *Releases only* — never every commit, issue, or generic repository
 * event — from the official GitHub REST API, mapping each Release into the
 * canonical {@link NormalizedItem} shape so it flows through the same
 * canonicalization → dedup → Article persistence → SourceFetch/health →
 * enrichment → clustering → ranking pipeline as any other Source.
 *
 * Safety and boundedness:
 *  - the endpoint is always `api.github.com/repos/{owner}/{repo}/releases`, built
 *    from validated owner/repo config — never an attacker-supplied URL;
 *  - pagination is bounded by `perPage` and `maxPages` from Source config;
 *  - the shared safe fetcher enforces SSRF, redirect bounds, timeout, size caps;
 *  - an optional server-only token is sent as a Bearer credential and is dropped
 *    before any cross-origin redirect (see the fetcher) and never logged;
 *  - conditional requests (ETag/Last-Modified) on the first page short-circuit to
 *    `notModified` when nothing changed;
 *  - drafts are always excluded; the prerelease policy is explicit;
 *  - the Release id yields a STABLE external id, so an *edited* Release maps to
 *    the same Article and never creates a duplicate (deterministic edit
 *    behaviour), and `html_url` is the canonical, publicly accessible target.
 */

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const RELEASE_EXCERPT_MAX = 500;

/** Minimal shape of a GitHub Release we depend on (all treated as untrusted). */
interface GithubRelease {
  id: unknown;
  html_url: unknown;
  tag_name: unknown;
  name: unknown;
  body: unknown;
  draft: unknown;
  prerelease: unknown;
  created_at: unknown;
  published_at: unknown;
  updated_at: unknown;
  author: unknown;
}

export const githubAcquirer: SourceAcquirer = {
  sourceTypes: ['GITHUB'],

  async acquire(
    source: SourceRow,
    ctx: AcquisitionContext,
  ): Promise<AcquisitionResult> {
    const config = parseSourceConfig(
      'GITHUB',
      source.source_config,
    ) as GithubSourceConfig;

    const token =
      ctx.githubToken === undefined ? resolveGithubToken() : ctx.githubToken;
    const baseHeaders: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': GITHUB_API_VERSION,
    };
    if (token) baseHeaders['authorization'] = `Bearer ${token}`;

    const items: NormalizedItem[] = [];
    let etag: string | null = null;
    let lastModified: string | null = null;
    let httpStatus: number | null = null;

    for (let page = 1; page <= config.maxPages; page += 1) {
      const url = releasesUrl(config, page);
      // Conditional requests only make sense against the first (newest) page;
      // a 304 there means no new releases have appeared.
      const conditional: FeedFetchOptions =
        page === 1
          ? { etag: source.etag, lastModified: source.last_modified }
          : {};

      let response;
      try {
        response = await ctx.fetchFeed(url, {
          ...ctx.fetchOptions,
          ...conditional,
          headers: baseHeaders,
        });
      } catch (error) {
        throw classifyGithubError(error);
      }

      httpStatus = response.status;

      if (page === 1 && response.notModified) {
        return {
          httpStatus: response.status,
          notModified: true,
          items: [],
          language: source.language ?? null,
          etag: response.etag ?? source.etag,
          lastModified: response.lastModified ?? source.last_modified,
        };
      }

      if (page === 1) {
        etag = response.etag ?? null;
        lastModified = response.lastModified ?? null;
      }

      const releases = parseReleases(response.body ?? '');
      for (const release of releases) {
        const item = toReleaseItem(release, config, source.language ?? null);
        if (item) items.push(item);
      }

      // Fewer than a full page means there are no further pages to fetch.
      if (releases.length < config.perPage) break;
    }

    return {
      httpStatus,
      notModified: false,
      items,
      language: source.language ?? null,
      etag,
      lastModified,
    };
  },
};

function releasesUrl(config: GithubSourceConfig, page: number): string {
  const owner = encodeURIComponent(config.owner);
  const repo = encodeURIComponent(config.repo);
  const params = new URLSearchParams({
    per_page: String(config.perPage),
    page: String(page),
  });
  return `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases?${params.toString()}`;
}

/** Parse the JSON body into a bounded array of releases, or throw MALFORMED_FEED. */
function parseReleases(body: string): GithubRelease[] {
  if (body.trim().length === 0) {
    throw new IngestError('EMPTY_RESPONSE', 'Empty GitHub response', {
      retryable: false,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new IngestError(
      'MALFORMED_FEED',
      'GitHub response is not valid JSON',
      {
        retryable: false,
        cause,
      },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new IngestError(
      'MALFORMED_FEED',
      'GitHub releases response was not an array',
      { retryable: false },
    );
  }
  return parsed as GithubRelease[];
}

/**
 * Map one Release into a canonical item, applying draft exclusion and the
 * configured prerelease policy. Returns null for excluded or malformed releases.
 */
function toReleaseItem(
  release: GithubRelease,
  config: GithubSourceConfig,
  language: string | null,
): NormalizedItem | null {
  if (!isRecord(release)) return null;

  // A stable numeric id and a canonical html_url are both required.
  const id = release.id;
  if (typeof id !== 'number' || !Number.isFinite(id)) return null;
  const htmlUrl = typeof release.html_url === 'string' ? release.html_url : '';
  if (htmlUrl.length === 0) return null;

  // Drafts are never ingested.
  if (release.draft === true) return null;

  // Explicit prerelease policy.
  const isPrerelease = release.prerelease === true;
  if (config.prereleases === 'exclude' && isPrerelease) return null;
  if (config.prereleases === 'only' && !isPrerelease) return null;

  const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
  const name = typeof release.name === 'string' ? release.name.trim() : '';
  const title = name || tag || `Release ${id}`;

  const publishedAt = parseDate(
    typeof release.published_at === 'string' ? release.published_at : null,
  );
  const createdAt = parseDate(
    typeof release.created_at === 'string' ? release.created_at : null,
  );
  // GitHub's Releases payload does not carry a top-level `updated_at` today, so
  // this is usually null and edits are detected downstream by a content-hash
  // change on the stable release id (see the edited-release policy in
  // docs/OPERATIONS.md). It is read defensively so that if a payload ever does
  // expose it, the edit timestamp is preserved as a source fact.
  const updatedAt = parseDate(
    typeof release.updated_at === 'string' ? release.updated_at : null,
  );

  return {
    // Stable across tag renames and edits, so an edited release maps to the same
    // Article (refreshed in place, never duplicated).
    externalId: `github:release:${id}`,
    url: htmlUrl,
    title,
    excerpt: releaseExcerpt(release.body),
    author: releaseAuthor(release.author),
    publishedAt: publishedAt ?? createdAt,
    updatedAt,
    imageUrl: null,
    language,
  };
}

/** A bounded, plain-ish excerpt from the (Markdown) release notes, or null. */
function releaseExcerpt(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  const plain = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length === 0) return null;
  return plain.length > RELEASE_EXCERPT_MAX
    ? `${plain.slice(0, RELEASE_EXCERPT_MAX).trimEnd()}…`
    : plain;
}

function releaseAuthor(author: unknown): string | null {
  if (isRecord(author) && typeof author.login === 'string' && author.login) {
    return author.login;
  }
  return null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

/**
 * Refine a fetch error: a GitHub primary/secondary rate-limit rejection arrives
 * as a 403 with `x-ratelimit-remaining: 0` (or a `retry-after`), which is
 * transient and must be classified as RATE_LIMITED rather than a permanent
 * client error. A 429 is already RATE_LIMITED upstream. Everything else passes
 * through unchanged.
 */
function classifyGithubError(error: unknown): unknown {
  if (!(error instanceof IngestError)) return error;
  if (error.httpStatus !== 403) return error;
  const headers = error.responseHeaders ?? {};
  const remaining = headers['x-ratelimit-remaining'];
  const retryAfter = headers['retry-after'];
  if (remaining === '0' || retryAfter !== undefined) {
    return new IngestError('RATE_LIMITED', 'GitHub API rate limit exceeded', {
      retryable: true,
      httpStatus: 403,
      cause: error,
    });
  }
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
