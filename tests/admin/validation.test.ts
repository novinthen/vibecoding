import { describe, expect, it } from 'vitest';

import {
  createSourceSchema,
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
});
