import { describe, expect, it } from 'vitest';

import {
  canonicalDefaultLocale,
  mergeLocalizedStory,
  normalizePublicLocale,
  resolveTargetLocale,
} from '@/public/locale';
import type { PublishedStory } from '@/public/types';

const base: PublishedStory = {
  id: 'story-1',
  publicationStoryId: 'ps-1',
  slug: 'launch',
  title: 'Default Headline',
  summary: 'Default summary.',
  whyItMatters: 'Default why.',
  topicName: 'Models',
  topicSlug: 'models',
  publishedAt: '2026-01-01T00:00:00.000Z',
  lastActivityAt: '2026-01-02T00:00:00.000Z',
};

describe('public locale policy', () => {
  it('normalises a valid requested locale and rejects junk', () => {
    expect(normalizePublicLocale('ms')).toBe('ms');
    expect(normalizePublicLocale(['en-us', 'ignored'])).toBe('en-US');
    expect(normalizePublicLocale('not a locale')).toBeNull();
    expect(normalizePublicLocale(undefined)).toBeNull();
  });

  it('prefers a valid requested locale, else the publication default', () => {
    expect(resolveTargetLocale('en', 'ms')).toBe('ms');
    expect(resolveTargetLocale('en', 'MS')).toBe('ms');
    // Ill-formed request is ignored — never trusted — falling to the default.
    expect(resolveTargetLocale('en', 'garbage')).toBe('en');
    expect(resolveTargetLocale('en', undefined)).toBe('en');
    // A weird default still canonicalises, falling back to en if impossible.
    expect(canonicalDefaultLocale('EN-us')).toBe('en-US');
    expect(canonicalDefaultLocale('???')).toBe('en');
  });

  it('overrides only the non-null localised fields; falls back to base otherwise', () => {
    const merged = mergeLocalizedStory(base, {
      locale: 'ms',
      headline: 'Tajuk Utama',
      summary: null,
      whyItMatters: 'Kenapa penting',
    });
    expect(merged.title).toBe('Tajuk Utama');
    // Null localised summary falls back to the publication default copy.
    expect(merged.summary).toBe('Default summary.');
    expect(merged.whyItMatters).toBe('Kenapa penting');
    // Non-content fields always come from the base.
    expect(merged.slug).toBe('launch');
    expect(merged.topicSlug).toBe('models');
    // The internal join key is not part of the rendered PublicStory shape.
    expect('publicationStoryId' in merged).toBe(false);
  });

  it('with no localisation renders the base publication copy unchanged', () => {
    const merged = mergeLocalizedStory(base, null);
    expect(merged.title).toBe('Default Headline');
    expect(merged.summary).toBe('Default summary.');
    expect(merged.whyItMatters).toBe('Default why.');
  });
});
