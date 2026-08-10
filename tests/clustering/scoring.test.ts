import { describe, expect, it } from 'vitest';

import {
  ASSIGN_THRESHOLD,
  cosineSimilarity,
  rankCandidates,
  scoreCandidate,
  selectAssignment,
  temporalScore,
  type ArticleFeatures,
  type CandidateFeatures,
  type RankedCandidate,
} from '@/clustering/scoring';
import { tokenSet, jaccard } from '@/clustering/tokens';

/**
 * Scoring model unit tests. The model is pure and deterministic: identical
 * evidence scores high, unrelated evidence low, and close calls are AMBIGUOUS
 * (no merge) — the false-split-over-false-merge bias, provable without a DB.
 */

const highVec = [1, 0, 0, 0];
const orthVec = [0, 1, 0, 0];

function articleFeatures(over: Partial<ArticleFeatures> = {}): ArticleFeatures {
  return {
    embedding: highVec,
    titleTokens: tokenSet('anthropic ships claude code feature'),
    entityIds: new Set<string>(),
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function candidate(over: Partial<CandidateFeatures> = {}): CandidateFeatures {
  return {
    storyId: over.storyId ?? 'story-1',
    representativeArticleId: 'rep-1',
    embedding: highVec,
    titleTokens: tokenSet('anthropic ships claude code feature'),
    entityIds: new Set<string>(),
    lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    sources: ['embedding'],
    ...over,
  };
}

describe('cosineSimilarity', () => {
  it('is 1 for identical, 0 for orthogonal, clamps negatives to 0', () => {
    expect(cosineSimilarity(highVec, highVec)).toBeCloseTo(1);
    expect(cosineSimilarity(highVec, orthVec)).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
  });
  it('returns 0 on dimension mismatch (incomparable spaces)', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });
});

describe('temporalScore', () => {
  it('is 1 when simultaneous and decays with time', () => {
    const t = new Date('2026-01-01T00:00:00Z');
    expect(temporalScore(t, t)).toBeCloseTo(1);
    const later = new Date('2026-01-03T00:00:00Z'); // +48h => 0.5
    expect(temporalScore(t, later)).toBeCloseTo(0.5, 2);
  });
  it('is 0 when a timestamp is missing (no signal, never closeness)', () => {
    expect(temporalScore(null, new Date())).toBe(0);
    expect(temporalScore(new Date(), null)).toBe(0);
  });
});

describe('jaccard', () => {
  it('measures token overlap', () => {
    expect(jaccard(tokenSet('aa bb cc'), tokenSet('aa bb cc'))).toBe(1);
    expect(jaccard(tokenSet('aa bb'), tokenSet('cc dd'))).toBe(0);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe('scoreCandidate', () => {
  it('scores identical evidence above the assign threshold', () => {
    const result = scoreCandidate(articleFeatures(), candidate());
    expect(result.signals.embedding).toBeCloseTo(1);
    expect(result.signals.title).toBeCloseTo(1);
    expect(result.passesGate).toBe(true);
    expect(result.passesThreshold).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(ASSIGN_THRESHOLD);
  });

  it('blocks a merge driven only by weak secondary signals (hard gate)', () => {
    // Orthogonal embedding + no title overlap, but shared entity + same time.
    const result = scoreCandidate(
      articleFeatures({
        embedding: orthVec,
        titleTokens: tokenSet('completely different words here'),
        entityIds: new Set(['e1']),
      }),
      candidate({
        embedding: highVec,
        titleTokens: tokenSet('nothing alike whatsoever now'),
        entityIds: new Set(['e1']),
      }),
    );
    expect(result.passesGate).toBe(false);
    expect(result.passesThreshold).toBe(false);
  });

  it('scores unrelated Articles well below threshold', () => {
    const result = scoreCandidate(
      articleFeatures({
        embedding: orthVec,
        titleTokens: tokenSet('unrelated market finance story'),
      }),
      candidate({
        embedding: highVec,
        titleTokens: tokenSet('anthropic ships claude code feature'),
      }),
    );
    expect(result.passesThreshold).toBe(false);
    expect(result.score).toBeLessThan(ASSIGN_THRESHOLD);
  });
});

describe('selectAssignment', () => {
  function ranked(
    scores: { storyId: string; passes: boolean; score: number }[],
  ): RankedCandidate[] {
    return scores.map((s) => ({
      storyId: s.storyId,
      representativeArticleId: null,
      score: s.score,
      signals: { embedding: s.score, title: s.score, entity: 0, temporal: 0 },
      passesGate: true,
      passesThreshold: s.passes,
      sources: ['embedding'],
    }));
  }

  it('CREATE when no candidate qualifies', () => {
    const s = selectAssignment(
      ranked([{ storyId: 'x', passes: false, score: 0.4 }]),
    );
    expect(s.outcome).toBe('CREATE');
    expect(s.best).toBeNull();
  });

  it('ASSIGN to the single clear winner', () => {
    const s = selectAssignment(
      ranked([
        { storyId: 'win', passes: true, score: 0.9 },
        { storyId: 'lose', passes: false, score: 0.5 },
      ]),
    );
    expect(s.outcome).toBe('ASSIGN');
    expect(s.best?.storyId).toBe('win');
  });

  it('ASSIGN when the runner-up is clearly weaker (outside margin)', () => {
    const s = selectAssignment(
      ranked([
        { storyId: 'win', passes: true, score: 0.9 },
        { storyId: 'second', passes: true, score: 0.78 },
      ]),
    );
    expect(s.outcome).toBe('ASSIGN');
    expect(s.best?.storyId).toBe('win');
  });

  it('AMBIGUOUS when two qualifying candidates are within the margin', () => {
    const s = selectAssignment(
      ranked([
        { storyId: 'a', passes: true, score: 0.9 },
        { storyId: 'b', passes: true, score: 0.88 },
      ]),
    );
    expect(s.outcome).toBe('AMBIGUOUS');
    expect(s.best).not.toBeNull();
    expect(s.runnerUp).not.toBeNull();
  });
});

describe('rankCandidates', () => {
  it('sorts by score descending and preserves candidate sources', () => {
    const result = rankCandidates(articleFeatures(), [
      candidate({ storyId: 'match', sources: ['embedding', 'entity'] }),
      candidate({
        storyId: 'weak',
        embedding: orthVec,
        titleTokens: tokenSet('nothing similar here at all'),
      }),
    ]);
    expect(result[0]?.storyId).toBe('match');
    expect(result[0]?.sources).toContain('entity');
    expect(result[0]?.score).toBeGreaterThan(result[1]?.score ?? 1);
  });
});
