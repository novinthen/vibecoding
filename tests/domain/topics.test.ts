import { describe, expect, it } from 'vitest';

import { TOP_LEVEL_TOPIC_NAMES, TOP_LEVEL_TOPIC_SEEDS } from '@/domain/topics';

describe('top-level topic taxonomy', () => {
  it('contains exactly the twelve controlled top-level Topics in order', () => {
    expect(TOP_LEVEL_TOPIC_NAMES).toEqual([
      'News',
      'Releases',
      'Tools',
      'Coding Agents',
      'Models',
      'MCP',
      'Open Source',
      'Developer Infrastructure',
      'Tutorials',
      'Research',
      'Business',
      'Community',
    ]);
  });

  it('derives unique, non-empty slugs for every Topic', () => {
    const slugs = TOP_LEVEL_TOPIC_SEEDS.map((seed) => seed.slug);
    expect(slugs.every((slug) => slug.length > 0)).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('produces the expected human-readable slugs', () => {
    const bySlug = Object.fromEntries(
      TOP_LEVEL_TOPIC_SEEDS.map((seed) => [seed.name, seed.slug]),
    );
    expect(bySlug['Coding Agents']).toBe('coding-agents');
    expect(bySlug['Open Source']).toBe('open-source');
    expect(bySlug['MCP']).toBe('mcp');
  });
});
