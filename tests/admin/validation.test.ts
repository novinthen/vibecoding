import { describe, expect, it } from 'vitest';

import {
  addDomainSchema,
  createPublicationSchema,
  createSourceSchema,
  createStoryLocalizationSchema,
  createTopicSchema,
  loginSchema,
  updateArticleStatusSchema,
} from '@/admin/validation';

describe('admin validation schemas', () => {
  it('accepts a valid Source and normalizes empties to null', () => {
    const parsed = createSourceSchema.parse({
      name: 'GitHub Blog',
      sourceType: 'RSS',
      authorityTier: 'TRUSTED',
      feedUrl: 'https://github.blog/feed/',
      homepageUrl: '',
      language: '',
      pollInterval: '',
      defaultTopicId: '',
    });
    expect(parsed.name).toBe('GitHub Blog');
    expect(parsed.homepageUrl).toBeNull();
    expect(parsed.pollInterval).toBeNull();
    expect(parsed.defaultTopicId).toBeNull();
  });

  it('rejects an invalid source type', () => {
    const result = createSourceSchema.safeParse({
      name: 'x',
      sourceType: 'CARRIER_PIGEON',
      authorityTier: 'TRUSTED',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-http feed URL', () => {
    const result = createSourceSchema.safeParse({
      name: 'x',
      sourceType: 'RSS',
      authorityTier: 'TRUSTED',
      feedUrl: 'javascript:alert(1)',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a blank name', () => {
    const result = createSourceSchema.safeParse({
      name: '   ',
      sourceType: 'RSS',
      authorityTier: 'TRUSTED',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive poll interval', () => {
    const result = createSourceSchema.safeParse({
      name: 'x',
      sourceType: 'RSS',
      authorityTier: 'TRUSTED',
      pollInterval: '-5',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an assembled source config object (per-type shape checked later)', () => {
    const parsed = createSourceSchema.parse({
      name: 'Next.js Releases',
      sourceType: 'GITHUB',
      authorityTier: 'TRUSTED',
      sourceConfig: {
        owner: 'vercel',
        repo: 'next.js',
        prereleases: 'exclude',
      },
    });
    expect(parsed.sourceConfig).toMatchObject({
      owner: 'vercel',
      repo: 'next.js',
    });
  });

  it('treats a missing source config as undefined (RSS/Atom carry none)', () => {
    const parsed = createSourceSchema.parse({
      name: 'Blog',
      sourceType: 'RSS',
      authorityTier: 'TRUSTED',
      feedUrl: 'https://example.com/feed',
    });
    expect(parsed.sourceConfig).toBeUndefined();
  });

  it('rejects a non-object source config', () => {
    const result = createSourceSchema.safeParse({
      name: 'x',
      sourceType: 'GITHUB',
      authorityTier: 'TRUSTED',
      sourceConfig: 'owner=vercel',
    });
    expect(result.success).toBe(false);
  });

  it('requires a valid status for Article status changes', () => {
    expect(
      updateArticleStatusSchema.safeParse({ status: 'HIDDEN' }).success,
    ).toBe(true);
    expect(
      updateArticleStatusSchema.safeParse({ status: 'NONSENSE' }).success,
    ).toBe(false);
  });

  it('requires a parent for a new Topic', () => {
    expect(
      createTopicSchema.safeParse({ name: 'Sub', parentId: 'not-a-uuid' })
        .success,
    ).toBe(false);
    expect(
      createTopicSchema.safeParse({
        name: 'Sub',
        parentId: '11111111-1111-1111-1111-111111111111',
      }).success,
    ).toBe(true);
  });

  it('requires username and password for login', () => {
    expect(
      loginSchema.safeParse({ username: 'a', password: 'b' }).success,
    ).toBe(true);
    expect(loginSchema.safeParse({ username: '', password: 'b' }).success).toBe(
      false,
    );
  });

  it('validates and canonicalises a Publication locale/timezone', () => {
    const ok = createPublicationSchema.safeParse({
      name: 'Berita',
      defaultLocale: 'ms-my',
      timezone: 'Asia/Kuala_Lumpur',
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.defaultLocale).toBe('ms-MY');

    expect(
      createPublicationSchema.safeParse({
        name: 'x',
        defaultLocale: 'not-a-locale',
        timezone: 'UTC',
      }).success,
    ).toBe(false);
    expect(
      createPublicationSchema.safeParse({
        name: 'x',
        defaultLocale: 'en',
        timezone: 'Mars/Phobos',
      }).success,
    ).toBe(false);
  });

  it('validates and lowercases a bare domain; rejects scheme/port/path', () => {
    const ok = addDomainSchema.safeParse({ domain: 'News.Example.com' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.domain).toBe('news.example.com');
    for (const bad of [
      'https://news.example.com',
      'news.example.com:3000',
      'news.example.com/path',
      'no-dot',
    ]) {
      expect(addDomainSchema.safeParse({ domain: bad }).success).toBe(false);
    }
  });

  it('accepts a StoryLocalization and normalises optional provenance', () => {
    const parsed = createStoryLocalizationSchema.parse({
      locale: 'ZH-hans',
      headline: 'x',
      summary: '',
      translationSource: '',
    });
    expect(parsed.locale).toBe('zh-Hans');
    expect(parsed.summary).toBeNull();
    expect(parsed.translationSource).toBeNull();
    expect(
      createStoryLocalizationSchema.safeParse({
        locale: 'ms',
        translationSource: 'ROBOT',
      }).success,
    ).toBe(false);
  });
});
