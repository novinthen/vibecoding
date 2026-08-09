import { describe, expect, it } from 'vitest';

import { feedAdapter, IngestError } from '@/ingestion';

import { loadFixture } from './fixtures';

function parse(name: string, contentType = 'application/xml') {
  return feedAdapter.parse({ body: loadFixture(name), contentType });
}

describe('feedAdapter — RSS 2.0', () => {
  it('parses channel metadata and items into the canonical shape', () => {
    const feed = parse('rss-basic.xml');
    expect(feed.title).toBe('Example Company Blog');
    expect(feed.language).toBe('en-us');
    expect(feed.items).toHaveLength(2);

    const [first] = feed.items;
    expect(first?.externalId).toBe('example-guid-0001');
    expect(first?.title).toBe('We shipped a new coding agent');
    expect(first?.url).toContain('https://example.com/blog/new-agent');
    expect(first?.author).toBe('Ada Lovelace');
    expect(first?.excerpt).toBe('Our new agent can write code.');
    expect(first?.imageUrl).toBe('https://cdn.example.com/img/agent.png');
    expect(first?.publishedAt?.toISOString()).toBe('2025-08-06T10:00:00.000Z');
    // Item language falls back to the feed language.
    expect(first?.language).toBe('en-us');
  });
});

describe('feedAdapter — Atom 1.0', () => {
  it('parses entries, choosing the alternate link and author name', () => {
    const feed = parse('atom-basic.xml');
    expect(feed.title).toBe('Dev Weblog');
    expect(feed.language).toBe('en');
    expect(feed.items).toHaveLength(2);

    const [first, second] = feed.items;
    expect(first?.url).toBe('https://dev.example.org/posts/vibe-coding');
    expect(first?.externalId).toBe(
      'tag:dev.example.org,2025:/posts/vibe-coding',
    );
    expect(first?.author).toBe('Grace Hopper');
    expect(first?.imageUrl).toBe('https://cdn.example.org/cover.jpg');
    expect(first?.publishedAt?.toISOString()).toBe('2025-08-05T09:00:00.000Z');
    expect(first?.updatedAt?.toISOString()).toBe('2025-08-06T09:00:00.000Z');

    // Second entry has only one unlabelled link and HTML content.
    expect(second?.url).toBe('https://dev.example.org/posts/model-notes');
    // HTML tags are stripped to a plain-ish excerpt.
    expect(second?.excerpt).toContain('Release notes');
    expect(second?.excerpt).not.toContain('<');
  });
});

describe('feedAdapter — tracking/redirect fixture', () => {
  it('exposes raw item URLs (canonicalization happens downstream)', () => {
    const feed = parse('rss-tracking-redirect.xml');
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]?.url).toContain('utm_source=twitter');
    expect(feed.items[0]?.externalId).toBe(
      'https://news.example.net/story/funding',
    );
  });
});

describe('feedAdapter — malformed input', () => {
  it('throws a classified MALFORMED_FEED error', () => {
    try {
      feedAdapter.parse({
        body: loadFixture('malformed.xml'),
        contentType: 'application/xml',
      });
      throw new Error('expected parse to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
      expect((error as IngestError).code).toBe('MALFORMED_FEED');
      expect((error as IngestError).retryable).toBe(false);
    }
  });

  it('throws EMPTY_RESPONSE for a blank body', () => {
    try {
      feedAdapter.parse({ body: '   ', contentType: null });
      throw new Error('expected parse to throw');
    } catch (error) {
      expect((error as IngestError).code).toBe('EMPTY_RESPONSE');
    }
  });

  it('throws MALFORMED_FEED for an unrecognised root element', () => {
    try {
      feedAdapter.parse({
        body: '<html><body>hi</body></html>',
        contentType: null,
      });
      throw new Error('expected parse to throw');
    } catch (error) {
      expect((error as IngestError).code).toBe('MALFORMED_FEED');
    }
  });
});

describe('feedAdapter — supports()', () => {
  it('recognises feeds by content type or body sniffing', () => {
    expect(
      feedAdapter.supports({ body: '', contentType: 'application/rss+xml' }),
    ).toBe(true);
    expect(
      feedAdapter.supports({ body: '<feed xmlns="...">', contentType: null }),
    ).toBe(true);
    expect(
      feedAdapter.supports({ body: 'plain text', contentType: 'text/plain' }),
    ).toBe(false);
  });
});
