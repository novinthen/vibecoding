import { describe, expect, it } from 'vitest';

import type { PublicationRow } from '@/domain/types';
import {
  defaultPublicationConfig,
  normalizeHostname,
  resolvePublicationConfig,
} from '@/public/publication';

/**
 * Publication resolution is the heart of the multi-publication seam: hostname →
 * PublicationDomain → Publication → config, with a safe default. These cover the
 * pure projection/normalisation; the DB lookup itself is covered by the
 * integration test.
 */
describe('normalizeHostname', () => {
  it('lowercases and strips the port', () => {
    expect(normalizeHostname('Example.COM:3000')).toBe('example.com');
    expect(normalizeHostname('news.example.org')).toBe('news.example.org');
  });

  it('does not strip a leading www (domains match exactly)', () => {
    expect(normalizeHostname('www.example.com')).toBe('www.example.com');
  });

  it('returns null for empty/absent input', () => {
    expect(normalizeHostname(null)).toBeNull();
    expect(normalizeHostname(undefined)).toBeNull();
    expect(normalizeHostname('   ')).toBeNull();
  });
});

describe('resolvePublicationConfig', () => {
  it('falls back to the in-code default when no row resolves', () => {
    const config = resolvePublicationConfig(null);
    expect(config).toEqual(defaultPublicationConfig());
    expect(config.source).toBe('default');
    expect(config.id).toBeNull();
    expect(config.locale).toBe('en');
  });

  it('projects a Publication row, preferring branding/SEO overrides', () => {
    const row: PublicationRow = {
      id: 'pub-1',
      name: 'Canonical Name',
      slug: 'global-en',
      default_locale: 'en-GB',
      timezone: 'Europe/London',
      status: 'ACTIVE',
      editorial_profile: {},
      branding: { name: 'Brand Override', tagline: 'Ship it' },
      seo_settings: { description: 'A focused portal.' },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const config = resolvePublicationConfig(row);
    expect(config.source).toBe('database');
    expect(config.id).toBe('pub-1');
    expect(config.name).toBe('Brand Override');
    expect(config.tagline).toBe('Ship it');
    expect(config.locale).toBe('en-GB');
    expect(config.description).toBe('A focused portal.');
  });

  it('uses the canonical name and defaults when branding/SEO are blank', () => {
    const row: PublicationRow = {
      id: 'pub-2',
      name: 'Bare Publication',
      slug: 'bare',
      default_locale: '',
      timezone: '',
      status: 'ACTIVE',
      editorial_profile: {},
      branding: {},
      seo_settings: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const config = resolvePublicationConfig(row);
    expect(config.name).toBe('Bare Publication');
    expect(config.tagline).toBeNull();
    expect(config.locale).toBe('en');
    expect(config.timezone).toBe('UTC');
    expect(config.description.length).toBeGreaterThan(0);
  });
});
