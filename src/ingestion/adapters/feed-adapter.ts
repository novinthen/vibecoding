import { XMLParser, XMLValidator } from 'fast-xml-parser';

import { IngestError } from '../http/errors';

import type {
  NormalizedItem,
  ParsedFeed,
  RawFeedPayload,
  SourceAdapter,
} from './types';

/**
 * RSS + Atom adapter.
 *
 * Handles the three XML syndication formats found in the wild — RSS 2.0, RSS 1.0
 * (RDF), and Atom 1.0 — behind one adapter, because they share an XML parse and
 * differ only in element mapping. Each format is mapped into the single
 * {@link NormalizedItem} canonical shape. Feed XML is untrusted input, so parsing
 * is defensive: unknown/missing fields degrade to null, a whole-payload parse
 * failure raises a classified MALFORMED_FEED error, and a single unusable item is
 * dropped rather than aborting the feed (the orchestrator counts the drop).
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep declared entities decoded; do not expand external/DOCTYPE entities.
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  // Never coerce ids/guids that look numeric into JS numbers — they are opaque.
  parseTagValue: false,
  parseAttributeValue: false,
});

/** Parse XML into a loose object tree, or throw MALFORMED_FEED. */
function parseXml(body: string): Record<string, unknown> {
  const trimmed = body.trimStart();
  if (trimmed.length === 0) {
    throw new IngestError('EMPTY_RESPONSE', 'Empty feed payload', {
      retryable: false,
    });
  }
  const valid = XMLValidator.validate(body);
  if (valid !== true) {
    throw new IngestError('MALFORMED_FEED', 'Feed is not well-formed XML', {
      retryable: false,
    });
  }
  try {
    return parser.parse(body) as Record<string, unknown>;
  } catch (cause) {
    throw new IngestError('MALFORMED_FEED', 'Could not parse feed XML', {
      retryable: false,
      cause,
    });
  }
}

type FeedKind = 'rss' | 'rdf' | 'atom';

function detectKind(root: Record<string, unknown>): FeedKind {
  if (isRecord(root.rss)) return 'rss';
  if (isRecord(root.feed)) return 'atom';
  if (isRecord(root['rdf:RDF']) || isRecord(root.RDF)) return 'rdf';
  throw new IngestError('MALFORMED_FEED', 'Unrecognised feed format', {
    retryable: false,
  });
}

/** The shared RSS/Atom adapter instance. */
export const feedAdapter: SourceAdapter = {
  name: 'rss-atom',
  sourceTypes: ['RSS', 'ATOM'],

  supports(payload: RawFeedPayload): boolean {
    const type = (payload.contentType ?? '').toLowerCase();
    if (type.includes('xml') || type.includes('rss') || type.includes('atom')) {
      return true;
    }
    // Fall back to sniffing the body for a feed root element.
    const head = payload.body.slice(0, 512).toLowerCase();
    return (
      head.includes('<rss') ||
      head.includes('<feed') ||
      head.includes('<rdf:rdf')
    );
  },

  parse(payload: RawFeedPayload): ParsedFeed {
    const root = parseXml(payload.body);
    const kind = detectKind(root);
    if (kind === 'atom') return parseAtom(root);
    return parseRss(root, kind);
  },
};

// ---------------------------------------------------------------------------
// RSS 2.0 / RSS 1.0 (RDF)
// ---------------------------------------------------------------------------

function parseRss(
  root: Record<string, unknown>,
  kind: 'rss' | 'rdf',
): ParsedFeed {
  const channel =
    kind === 'rss'
      ? pickRecord(root.rss, 'channel')
      : pickRecord(root['rdf:RDF'] ?? root.RDF, 'channel');

  const feedLanguage =
    text(channel?.language) || text(channel?.['dc:language']);

  // RSS 2.0 nests <item> under <channel>; RSS 1.0 lists them as RDF siblings.
  const rdfRoot = isRecord(root['rdf:RDF'])
    ? root['rdf:RDF']
    : isRecord(root.RDF)
      ? root.RDF
      : {};
  const rawItems =
    kind === 'rss'
      ? asArray(channel?.item)
      : asArray(rdfRoot.item ?? channel?.item);

  const items: NormalizedItem[] = [];
  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    const item = mapRssItem(raw, feedLanguage);
    if (item) items.push(item);
  }

  return {
    title: text(channel?.title) || null,
    language: feedLanguage || null,
    items,
  };
}

function mapRssItem(
  raw: Record<string, unknown>,
  feedLanguage: string,
): NormalizedItem | null {
  const url = firstNonEmpty(
    text(raw.link),
    // RSS 1.0 items carry their URL as the rdf:about attribute.
    text(raw['@_rdf:about']),
    // Some feeds only expose a permalink guid.
    guidPermalink(raw.guid),
  );
  const title = firstNonEmpty(text(raw.title), url);
  if (!url || !title) return null;

  const externalId =
    guidValue(raw.guid) || firstNonEmpty(text(raw['dc:identifier'])) || null;

  return {
    externalId,
    url,
    title,
    excerpt: cleanExcerpt(
      firstNonEmpty(text(raw.description), text(raw['content:encoded'])),
    ),
    author:
      firstNonEmpty(
        text(raw['dc:creator']),
        text(raw.author),
        text(raw['itunes:author']),
      ) || null,
    publishedAt: parseDate(
      firstNonEmpty(
        text(raw.pubDate),
        text(raw['dc:date']),
        text(raw.published),
      ),
    ),
    updatedAt: parseDate(
      firstNonEmpty(text(raw['atom:updated']), text(raw.updated)),
    ),
    imageUrl: rssImage(raw),
    language: firstNonEmpty(text(raw['dc:language'])) || feedLanguage || null,
  };
}

function rssImage(raw: Record<string, unknown>): string | null {
  const enclosure = raw.enclosure;
  for (const enc of asArray(enclosure)) {
    if (!isRecord(enc)) continue;
    const type = text(enc['@_type']).toLowerCase();
    const href = text(enc['@_url']);
    if (href && (type.startsWith('image/') || type === '')) return href;
  }
  const media = firstNonEmpty(
    mediaAttr(raw['media:content'], '@_url'),
    mediaAttr(raw['media:thumbnail'], '@_url'),
  );
  return media || null;
}

// ---------------------------------------------------------------------------
// Atom 1.0
// ---------------------------------------------------------------------------

function parseAtom(root: Record<string, unknown>): ParsedFeed {
  const feed = isRecord(root.feed) ? root.feed : {};
  const feedLanguage = text(feed['@_xml:lang']);

  const items: NormalizedItem[] = [];
  for (const raw of asArray(feed.entry)) {
    if (!isRecord(raw)) continue;
    const item = mapAtomEntry(raw, feedLanguage);
    if (item) items.push(item);
  }

  return {
    title: text(feed.title) || null,
    language: feedLanguage || null,
    items,
  };
}

function mapAtomEntry(
  raw: Record<string, unknown>,
  feedLanguage: string,
): NormalizedItem | null {
  const url = atomLink(raw.link);
  const title = firstNonEmpty(text(raw.title), url);
  if (!url || !title) return null;

  return {
    externalId: firstNonEmpty(text(raw.id)) || null,
    url,
    title,
    excerpt: cleanExcerpt(firstNonEmpty(text(raw.summary), text(raw.content))),
    author: atomAuthor(raw.author),
    publishedAt: parseDate(
      firstNonEmpty(text(raw.published), text(raw.updated)),
    ),
    updatedAt: parseDate(text(raw.updated)),
    imageUrl: atomImage(raw.link),
    language: firstNonEmpty(text(raw['@_xml:lang'])) || feedLanguage || null,
  };
}

/** Choose the best Atom `<link>`: rel="alternate" (or unlabelled) over others. */
function atomLink(link: unknown): string {
  const links = asArray(link);
  let fallback = '';
  for (const entry of links) {
    if (typeof entry === 'string') {
      if (!fallback) fallback = entry;
      continue;
    }
    if (!isRecord(entry)) continue;
    const rel = text(entry['@_rel']);
    const href = text(entry['@_href']);
    if (!href) continue;
    if (rel === 'alternate' || rel === '') return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}

function atomImage(link: unknown): string | null {
  for (const entry of asArray(link)) {
    if (!isRecord(entry)) continue;
    if (text(entry['@_rel']) === 'enclosure') {
      const type = text(entry['@_type']).toLowerCase();
      const href = text(entry['@_href']);
      if (href && type.startsWith('image/')) return href;
    }
  }
  return null;
}

function atomAuthor(author: unknown): string | null {
  for (const entry of asArray(author)) {
    if (isRecord(entry)) {
      const name = firstNonEmpty(text(entry.name), text(entry.email));
      if (name) return name;
    } else if (typeof entry === 'string' && entry.trim()) {
      return entry.trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function guidValue(guid: unknown): string {
  if (typeof guid === 'string') return guid.trim();
  if (isRecord(guid)) return text(guid['#text']);
  return '';
}

function guidPermalink(guid: unknown): string {
  if (isRecord(guid)) {
    const isPermaLink = text(guid['@_isPermaLink']).toLowerCase();
    const value = text(guid['#text']);
    if (isPermaLink !== 'false' && /^https?:\/\//i.test(value)) return value;
  }
  return '';
}

function mediaAttr(node: unknown, attr: string): string {
  for (const entry of asArray(node)) {
    if (isRecord(entry)) {
      const value = text(entry[attr]);
      if (value) return value;
    }
  }
  return '';
}

/** Extract text from a string, or an object with `#text` (attributed element). */
function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (isRecord(value)) {
    const inner = value['#text'];
    if (typeof inner === 'string') return inner.trim();
    if (typeof inner === 'number') return String(inner);
  }
  return '';
}

/** Strip HTML tags and collapse whitespace to a plain-ish excerpt. */
function cleanExcerpt(html: string): string | null {
  if (!html) return null;
  const plain = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 0 ? plain : null;
}

/** Parse a date string (RFC822 or ISO8601) into a UTC Date, or null. */
function parseDate(value: string): Date | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value && value.length > 0) return value;
  }
  return '';
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (isRecord(value) && isRecord(value[key])) {
    return value[key] as Record<string, unknown>;
  }
  return undefined;
}
