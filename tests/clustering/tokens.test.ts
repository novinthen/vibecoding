import { describe, expect, it } from 'vitest';

import { parseVector } from '@/clustering/candidates';
import { jaccard, tokenize, tokenSet } from '@/clustering/tokens';

describe('tokenize', () => {
  it('lowercases, strips punctuation, and drops single chars', () => {
    expect(tokenize('Claude Code: a NEW tool!')).toEqual([
      'claude',
      'code',
      'new',
      'tool',
    ]);
  });
  it('strips diacritics deterministically', () => {
    expect(tokenize('Café déjà')).toEqual(['cafe', 'deja']);
  });
});

describe('tokenSet / jaccard', () => {
  it('dedupes tokens', () => {
    expect(tokenSet('a a bb bb cc').size).toBe(2);
  });
  it('computes overlap', () => {
    expect(jaccard(tokenSet('aa bb cc'), tokenSet('bb cc dd'))).toBeCloseTo(
      0.5,
    );
  });
});

describe('parseVector', () => {
  it('parses a pgvector literal into numbers', () => {
    expect(parseVector('[0.1,0.2,0.3]')).toEqual([0.1, 0.2, 0.3]);
  });
  it('returns [] for malformed input rather than throwing', () => {
    expect(parseVector('not a vector')).toEqual([]);
    expect(parseVector('')).toEqual([]);
  });
});
