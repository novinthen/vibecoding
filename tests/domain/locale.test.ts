import { describe, expect, it } from 'vitest';

import { canonicalizeLocale, isValidLocale } from '@/domain/locale';

/**
 * BCP-47-ish locale validation/canonicalisation. Locales are stored as rows and
 * must be validated safely; nothing hardcodes a single language or region.
 */
describe('canonicalizeLocale', () => {
  it('accepts and canonicalises common well-formed locales', () => {
    expect(canonicalizeLocale('en')).toBe('en');
    expect(canonicalizeLocale('EN')).toBe('en');
    expect(canonicalizeLocale('ms')).toBe('ms');
    expect(canonicalizeLocale('en-us')).toBe('en-US');
    expect(canonicalizeLocale('EN-US')).toBe('en-US');
    expect(canonicalizeLocale('zh-hans')).toBe('zh-Hans');
    expect(canonicalizeLocale('pt-br')).toBe('pt-BR');
    expect(canonicalizeLocale('  fr  ')).toBe('fr');
  });

  it('supports a UN M.49 numeric region', () => {
    expect(canonicalizeLocale('es-419')).toBe('es-419');
  });

  it('rejects ill-formed / unsafe input', () => {
    for (const bad of [
      '',
      '   ',
      'e',
      'english',
      'en_US',
      'en-USA',
      '123',
      'en-',
      'zh-Hans-CN-x', // trailing garbage beyond the supported subset
      '<script>',
      'en;DROP',
    ]) {
      expect(canonicalizeLocale(bad)).toBeNull();
      expect(isValidLocale(bad)).toBe(false);
    }
  });
});
