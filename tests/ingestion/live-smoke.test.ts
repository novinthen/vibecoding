import { describe, expect, it } from 'vitest';

import { fetchFeed, feedAdapter } from '@/ingestion';
import { REPRESENTATIVE_SOURCES } from '@/ingestion';

/**
 * Live representative-source smoke tests.
 *
 * OPT-IN ONLY: skipped unless INGEST_LIVE_SMOKE=1. Kept out of normal CI so that
 * a third-party outage can never make CI flaky (per the Stage 3 testing rule).
 * These hit the real network to validate that the representative registry feeds
 * still fetch and parse into canonical items. Run locally with:
 *
 *   INGEST_LIVE_SMOKE=1 npx vitest run tests/ingestion/live-smoke.test.ts
 */
const live = process.env.INGEST_LIVE_SMOKE === '1';

// This smoke test validates the RSS/Atom fetch-and-parse path specifically, so
// it covers only feed-based Sources. GitHub Releases and Hacker News use their
// own acquisition path (validated deterministically with fixtures) and carry no
// feed URL, so they are intentionally excluded here.
const FEED_SOURCES = REPRESENTATIVE_SOURCES.filter((s) => Boolean(s.feedUrl));

describe.skipIf(!live)('live representative sources (smoke)', () => {
  for (const source of FEED_SOURCES) {
    it(`fetches and parses ${source.slug}`, async () => {
      const feedUrl = source.feedUrl;
      expect(feedUrl, `${source.slug} needs a feed URL`).toBeTruthy();

      const response = await fetchFeed(feedUrl as string, {
        timeoutMs: 15_000,
      });
      expect(response.status).toBe(200);
      expect(response.body).toBeTruthy();

      const parsed = feedAdapter.parse({
        body: response.body ?? '',
        contentType: response.contentType,
      });
      expect(parsed.items.length).toBeGreaterThan(0);
      for (const item of parsed.items.slice(0, 3)) {
        expect(item.url).toMatch(/^https?:\/\//);
        expect(item.title.length).toBeGreaterThan(0);
      }
    }, 20_000);
  }
});
