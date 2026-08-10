import type { PublishedStory } from './types';

/**
 * Publication-aware Atom feed construction (Stage 5B).
 *
 * A feed is publication-specific: it uses that Publication's own domain, its
 * Story selection (PUBLISHED PublicationStories), the Publication's editorial
 * copy, and its default-locale metadata. It is NOT a source-article republishing
 * feed — entries are the Publication's Story projection, attributed to the
 * Publication, linking back to the on-site Story (which itself preserves source
 * attribution and outbound links). Pure and side-effect free so the XML is
 * directly testable; all dynamic values are XML-escaped.
 */
export interface FeedInput {
  siteName: string;
  /** Absolute origin for this Publication, e.g. `https://news.example.com`. */
  baseUrl: string;
  /** Publication default locale (BCP-47) for the feed's xml:lang. */
  locale: string;
  description: string;
  stories: readonly PublishedStory[];
}

/** Escape text for safe inclusion in XML element content and attributes. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRfc3339(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Build a complete Atom 1.0 feed document for a Publication. */
export function buildAtomFeed(input: FeedInput): string {
  const base = input.baseUrl.replace(/\/+$/, '');
  const feedUrl = `${base}/feed.xml`;

  // Feed-level updated = most recent entry timestamp, else now.
  const entryTimes = input.stories
    .map((s) => toRfc3339(s.publishedAt ?? s.lastActivityAt))
    .filter((t): t is string => t !== null)
    .sort();
  const updated = entryTimes[entryTimes.length - 1] ?? new Date().toISOString();

  const entries = input.stories
    .map((story) => {
      const storyUrl = `${base}/story/${encodeURIComponent(story.slug)}`;
      const entryUpdated =
        toRfc3339(story.publishedAt ?? story.lastActivityAt) ?? updated;
      const summary = story.summary
        ? `\n    <summary>${escapeXml(story.summary)}</summary>`
        : '';
      return (
        `  <entry>\n` +
        `    <title>${escapeXml(story.title)}</title>\n` +
        `    <id>${escapeXml(storyUrl)}</id>\n` +
        `    <link rel="alternate" href="${escapeXml(storyUrl)}"/>\n` +
        `    <updated>${entryUpdated}</updated>` +
        `${summary}\n` +
        `  </entry>`
      );
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${escapeXml(input.locale)}">\n` +
    `  <title>${escapeXml(input.siteName)}</title>\n` +
    `  <subtitle>${escapeXml(input.description)}</subtitle>\n` +
    `  <id>${escapeXml(feedUrl)}</id>\n` +
    `  <link rel="self" href="${escapeXml(feedUrl)}"/>\n` +
    `  <link rel="alternate" href="${escapeXml(base)}/"/>\n` +
    `  <updated>${updated}</updated>\n` +
    `  <author><name>${escapeXml(input.siteName)}</name></author>\n` +
    (entries ? `${entries}\n` : '') +
    `</feed>\n`
  );
}
