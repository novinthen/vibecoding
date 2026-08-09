import { describe, expect, it } from 'vitest';

import { slugify } from '@/domain/slug';

describe('slugify', () => {
  it('lowercases and hyphenates multi-word names', () => {
    expect(slugify('Coding Agents')).toBe('coding-agents');
    expect(slugify('Developer Infrastructure')).toBe(
      'developer-infrastructure',
    );
  });

  it('preserves acronyms as lowercase', () => {
    expect(slugify('MCP')).toBe('mcp');
  });

  it('strips diacritics deterministically (locale-independent)', () => {
    expect(slugify('Café Déjà')).toBe('cafe-deja');
  });

  it('collapses punctuation and repeated separators', () => {
    expect(slugify('  Hello --- World!!  ')).toBe('hello-world');
  });

  it('returns an empty string for input with no alphanumerics', () => {
    expect(slugify('   ---   ')).toBe('');
  });
});
