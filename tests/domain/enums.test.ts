import { describe, expect, it } from 'vitest';

import {
  ARTICLE_STATUSES,
  articleStatusSchema,
  AUTHORITY_TIERS,
  authorityTierSchema,
  entityTypeSchema,
  HEALTH_STATUSES,
  SOURCE_TYPES,
  sourceTypeSchema,
  STORY_STATUSES,
  storyStatusSchema,
} from '@/domain/enums';

describe('controlled vocabularies', () => {
  it('accepts every declared source type and rejects unknown values', () => {
    for (const value of SOURCE_TYPES) {
      expect(sourceTypeSchema.parse(value)).toBe(value);
    }
    expect(sourceTypeSchema.safeParse('SCRAPER').success).toBe(false);
  });

  it('enforces the controlled authority tiers', () => {
    expect(AUTHORITY_TIERS).toContain('PRIMARY');
    expect(authorityTierSchema.safeParse('RANDOM').success).toBe(false);
  });

  it('covers the full future-compatible article lifecycle', () => {
    expect(ARTICLE_STATUSES).toContain('DISCOVERED');
    expect(ARTICLE_STATUSES).toContain('PUBLISHED');
    expect(articleStatusSchema.safeParse('DELETED').success).toBe(false);
  });

  it('enforces controlled story statuses', () => {
    expect(STORY_STATUSES).toContain('MERGED');
    expect(storyStatusSchema.safeParse('LIVE').success).toBe(false);
  });

  it('enforces controlled health statuses and entity types', () => {
    expect(HEALTH_STATUSES).toContain('DEGRADED');
    expect(entityTypeSchema.safeParse('MODEL').success).toBe(true);
    expect(entityTypeSchema.safeParse('ROBOT').success).toBe(false);
  });
});
