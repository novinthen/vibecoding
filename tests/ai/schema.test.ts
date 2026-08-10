import { describe, expect, it } from 'vitest';

import { validateEnrichmentOutput } from '@/ai/enrichment/schema';

const VALID = {
  relevance: 'RELEVANT',
  relevanceReason: 'It is about a coding agent.',
  summary: 'A new coding agent shipped.',
  whyItMatters: 'Developers get a faster workflow.',
  suggestedTopics: [{ name: 'Coding Agents', slug: 'coding-agents' }],
  suggestedEntities: [
    { name: 'Claude Code', type: 'PRODUCT', confidence: 0.9 },
  ],
  confidence: 0.8,
};

describe('validateEnrichmentOutput', () => {
  it('accepts a well-formed object and normalises optional fields', () => {
    const result = validateEnrichmentOutput(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.relevance).toBe('RELEVANT');
      expect(result.value.suggestedTopics[0]?.confidence).toBeNull();
      expect(result.value.suggestedEntities[0]?.type).toBe('PRODUCT');
    }
  });

  it('defaults missing suggestion arrays to empty', () => {
    const { suggestedTopics: _t, suggestedEntities: _e, ...rest } = VALID;
    const result = validateEnrichmentOutput(rest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestedTopics).toEqual([]);
      expect(result.value.suggestedEntities).toEqual([]);
    }
  });

  it('rejects a non-object', () => {
    expect(validateEnrichmentOutput(null).ok).toBe(false);
    expect(validateEnrichmentOutput('a string').ok).toBe(false);
    expect(validateEnrichmentOutput(42).ok).toBe(false);
  });

  it('rejects a partial/malformed object (missing required fields)', () => {
    const result = validateEnrichmentOutput({ relevance: 'RELEVANT' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it('rejects unknown extra keys (strict schema)', () => {
    const result = validateEnrichmentOutput({ ...VALID, injected: 'evil' });
    expect(result.ok).toBe(false);
  });

  it('rejects UNCLASSIFIED from the model (system-only value)', () => {
    const result = validateEnrichmentOutput({
      ...VALID,
      relevance: 'UNCLASSIFIED',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an out-of-range confidence', () => {
    expect(validateEnrichmentOutput({ ...VALID, confidence: 1.5 }).ok).toBe(
      false,
    );
    expect(validateEnrichmentOutput({ ...VALID, confidence: -0.1 }).ok).toBe(
      false,
    );
  });

  it('rejects an invalid entity type when present', () => {
    const result = validateEnrichmentOutput({
      ...VALID,
      suggestedEntities: [{ name: 'X', type: 'ROBOT' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a wrong-typed field', () => {
    const result = validateEnrichmentOutput({ ...VALID, summary: 123 });
    expect(result.ok).toBe(false);
  });
});
