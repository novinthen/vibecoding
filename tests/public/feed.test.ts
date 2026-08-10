import { describe, expect, it } from 'vitest';

import { buildAtomFeed, escapeXml } from '@/public/feed';
import type { PublishedStory } from '@/public/types';

function story(overrides: Partial<PublishedStory>): PublishedStory {
  return {
    id: 'id',
    publicationStoryId: 'ps',
    slug: 'a-story',
    title: 'A Story',
    summary: 'A summary.',
    whyItMatters: null,
    topicName: null,
    topicSlug: null,
    publishedAt: '2026-01-05T00:00:00.000Z',
    lastActivityAt: '2026-01-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('publication Atom feed', () => {
  it('escapes untrusted text so it cannot break the XML', () => {
    expect(escapeXml('a & b < c > "d" \'e\'')).toBe(
      'a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;',
    );
    const xml = buildAtomFeed({
      siteName: 'Brand & Co <x>',
      baseUrl: 'https://news.example.com',
      locale: 'en',
      description: 'Desc <b>',
      stories: [story({ title: 'Headline & <danger>' })],
    });
    expect(xml).not.toContain('<danger>');
    expect(xml).toContain('Headline &amp; &lt;danger&gt;');
    expect(xml).toContain('Brand &amp; Co &lt;x&gt;');
  });

  it('uses the Publication domain, locale, and self/alternate links', () => {
    const xml = buildAtomFeed({
      siteName: 'Berita',
      baseUrl: 'https://berita.example.com',
      locale: 'ms',
      description: 'Berita pembangun',
      stories: [story({ slug: 'pelancaran' })],
    });
    expect(xml).toContain('xml:lang="ms"');
    expect(xml).toContain(
      '<link rel="self" href="https://berita.example.com/feed.xml"/>',
    );
    expect(xml).toContain(
      '<link rel="alternate" href="https://berita.example.com/"/>',
    );
    expect(xml).toContain('href="https://berita.example.com/story/pelancaran"');
    // Publication-attributed author.
    expect(xml).toContain('<author><name>Berita</name></author>');
  });

  it('produces a valid empty feed when there are no published stories', () => {
    const xml = buildAtomFeed({
      siteName: 'Empty',
      baseUrl: 'https://empty.example.com',
      locale: 'en',
      description: 'Nothing yet',
      stories: [],
    });
    expect(xml).toContain('<feed');
    expect(xml).toContain('</feed>');
    expect(xml).not.toContain('<entry>');
  });
});
