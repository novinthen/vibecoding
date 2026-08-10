import { describe, expect, it } from 'vitest';

import { defaultPublicationConfig } from '@/public/publication';
import {
  buildMetadata,
  canonicalUrl,
  jsonLdScriptContent,
} from '@/public/metadata';

const config = { ...defaultPublicationConfig(), name: 'Test Portal' };
const baseUrl = 'https://news.example.com';

describe('canonicalUrl', () => {
  it('joins base and path without double slashes', () => {
    expect(canonicalUrl('https://a.com/', '/latest')).toBe(
      'https://a.com/latest',
    );
    expect(canonicalUrl('https://a.com', 'latest')).toBe(
      'https://a.com/latest',
    );
  });

  it('renders the root path as a trailing slash', () => {
    expect(canonicalUrl('https://a.com', '/')).toBe('https://a.com/');
  });
});

describe('buildMetadata', () => {
  it('sets a publication-aware canonical URL from the request base', () => {
    const meta = buildMetadata({ config, baseUrl, path: '/topic/models' });
    expect(meta.alternates?.canonical).toBe(
      'https://news.example.com/topic/models',
    );
    expect(meta.openGraph?.url).toBe('https://news.example.com/topic/models');
  });

  it('appends the site name to a page title but not the home title', () => {
    expect(
      buildMetadata({ config, baseUrl, path: '/latest', title: 'Latest' })
        .title,
    ).toBe('Latest — Test Portal');
    expect(buildMetadata({ config, baseUrl, path: '/' }).title).toBe(
      'Test Portal',
    );
  });

  it('emits noindex when index is false (e.g. search results)', () => {
    const meta = buildMetadata({
      config,
      baseUrl,
      path: '/search',
      index: false,
    });
    const robots = meta.robots as { index?: boolean; follow?: boolean };
    expect(robots.index).toBe(false);
    expect(robots.follow).toBe(true);
  });

  it('defaults to indexable with the publication description', () => {
    const meta = buildMetadata({ config, baseUrl, path: '/' });
    const robots = meta.robots as { index?: boolean };
    expect(robots.index).toBe(true);
    expect(meta.description).toBe(config.description);
  });

  it('overrides OG locale for a localisation-aware page', () => {
    const meta = buildMetadata({
      config,
      baseUrl,
      path: '/story/x?locale=ms',
      locale: 'ms',
    });
    expect(meta.openGraph?.locale).toBe('ms');
    // Absent an override, the OG locale is the publication default.
    const dflt = buildMetadata({ config, baseUrl, path: '/story/x' });
    expect(dflt.openGraph?.locale).toBe(config.locale);
  });

  it('emits hreflang alternates only within the same publication origin', () => {
    const meta = buildMetadata({
      config,
      baseUrl,
      path: '/story/x?locale=ms',
      locale: 'ms',
      languageAlternates: {
        en: 'https://news.example.com/story/x',
        ms: 'https://news.example.com/story/x?locale=ms',
      },
    });
    const languages = meta.alternates?.languages as Record<string, string>;
    expect(languages.en).toBe('https://news.example.com/story/x');
    expect(languages.ms).toBe('https://news.example.com/story/x?locale=ms');
    // Every alternate stays on this publication's own origin (no cross-domain).
    for (const url of Object.values(languages)) {
      expect(url.startsWith('https://news.example.com/')).toBe(true);
    }
  });
});

describe('jsonLdScriptContent', () => {
  it('escapes every "<" so untrusted values cannot break out of <script>', () => {
    const hostile = { headline: '</script><script>alert(1)</script>' };
    const out = jsonLdScriptContent(hostile);
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('\\u003c');
    // Still valid JSON that round-trips back to the original value.
    expect(JSON.parse(out).headline).toBe('</script><script>alert(1)</script>');
  });
});
