import { describe, expect, it } from 'vitest';

import {
  parseSourceConfig,
  sourceConfigForStorage,
  sourceConfigSummary,
} from '@/ingestion/source-config';

/**
 * Deterministic tests for the per-source-type adapter config validation
 * (Stage 9B). This is the AUTHORITATIVE server-side validation the admin service
 * delegates to; the operator-friendly form fields are only an input surface.
 */

describe('sourceConfig — RSS/Atom (no config)', () => {
  it('accepts an empty object and rejects unknown keys', () => {
    expect(sourceConfigForStorage('RSS', {})).toEqual({});
    expect(sourceConfigForStorage('ATOM', undefined)).toEqual({});
    expect(() => parseSourceConfig('RSS', { owner: 'x' })).toThrow();
  });
});

describe('sourceConfig — GitHub', () => {
  it('requires owner and repo', () => {
    expect(() => parseSourceConfig('GITHUB', {})).toThrow();
    expect(() => parseSourceConfig('GITHUB', { owner: 'vercel' })).toThrow();
  });

  it('applies defaults for prereleases/perPage/maxPages', () => {
    const cfg = parseSourceConfig('GITHUB', {
      owner: 'vercel',
      repo: 'next.js',
    });
    expect(cfg).toMatchObject({
      owner: 'vercel',
      repo: 'next.js',
      prereleases: 'exclude',
      perPage: 30,
      maxPages: 1,
    });
  });

  it('rejects path-traversal owner/repo values', () => {
    expect(() =>
      parseSourceConfig('GITHUB', { owner: '..', repo: 'x' }),
    ).toThrow();
    expect(() =>
      parseSourceConfig('GITHUB', { owner: 'o', repo: 'a/b' }),
    ).toThrow();
    expect(() =>
      parseSourceConfig('GITHUB', { owner: 'o', repo: '.' }),
    ).toThrow();
  });

  it('bounds pagination and validates the prerelease enum', () => {
    expect(() =>
      parseSourceConfig('GITHUB', {
        owner: 'o',
        repo: 'r',
        perPage: 101,
      }),
    ).toThrow();
    expect(() =>
      parseSourceConfig('GITHUB', { owner: 'o', repo: 'r', maxPages: 6 }),
    ).toThrow();
    expect(() =>
      parseSourceConfig('GITHUB', {
        owner: 'o',
        repo: 'r',
        prereleases: 'sometimes',
      }),
    ).toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() =>
      parseSourceConfig('GITHUB', { owner: 'o', repo: 'r', token: 'secret' }),
    ).toThrow();
  });

  it('summarizes without leaking anything sensitive', () => {
    const summary = sourceConfigSummary('GITHUB', {
      owner: 'o',
      repo: 'r',
    });
    expect(summary).toMatchObject({ owner: 'o', repo: 'r' });
    expect(JSON.stringify(summary)).not.toContain('token');
  });
});

describe('sourceConfig — Hacker News', () => {
  it('defaults mode/maxItems and rejects ids unless mode is ids', () => {
    const cfg = parseSourceConfig('HACKER_NEWS', {});
    expect(cfg).toMatchObject({ mode: 'top', maxItems: 50 });
    expect(() =>
      parseSourceConfig('HACKER_NEWS', { mode: 'top', ids: [1] }),
    ).toThrow();
  });

  it('requires at least one id when mode is ids', () => {
    expect(() =>
      parseSourceConfig('HACKER_NEWS', { mode: 'ids', ids: [] }),
    ).toThrow();
    expect(
      parseSourceConfig('HACKER_NEWS', { mode: 'ids', ids: [38001234] }),
    ).toMatchObject({ mode: 'ids', ids: [38001234] });
  });

  it('bounds maxItems and validates the mode enum', () => {
    expect(() =>
      parseSourceConfig('HACKER_NEWS', { mode: 'top', maxItems: 201 }),
    ).toThrow();
    expect(() =>
      parseSourceConfig('HACKER_NEWS', { mode: 'trending' }),
    ).toThrow();
  });
});
