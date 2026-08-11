import type { CreateSourceInput } from '@/domain';

/**
 * Representative Source registry.
 *
 * Per the Stage 3 rollout rule, the architecture is first proven on a SMALL
 * approved set covering different feed behaviours — not 30+ sources at once. The
 * tricky behaviours (redirect + tracking-parameter URLs, malformed/failing
 * feeds) are proven deterministically with stored fixtures in the test suite, so
 * this live registry only needs to cover the two happy-path wire formats:
 *
 *  - one official company RSS feed;
 *  - one Atom feed from a recognised developer publication.
 *
 * These entries are candidates for optional, gated live smoke validation
 * (INGEST_LIVE_SMOKE=1) and for the CLI `--register` command; they are NOT
 * enabled automatically and should be verified before broad rollout. Do not
 * expand this list broadly until representative validation passes.
 *
 * Stage 9B adds two developer-intelligence Sources — one GitHub Releases Source
 * and one Hacker News Source — to prove the acquisition seam end to end. They
 * flow through the SAME ingestion engine as the RSS/Atom entries; only their
 * `sourceType` and `sourceConfig` differ.
 */

export interface RegistrySource extends CreateSourceInput {
  /** Human note on why this Source is in the representative set. */
  note: string;
}

export const REPRESENTATIVE_SOURCES: readonly RegistrySource[] = [
  {
    name: 'GitHub Blog',
    slug: 'github-blog',
    sourceType: 'RSS',
    authorityTier: 'TRUSTED',
    homepageUrl: 'https://github.blog/',
    feedUrl: 'https://github.blog/feed/',
    language: 'en',
    note: 'Official company RSS feed (RSS 2.0 wire format).',
  },
  {
    name: "Simon Willison's Weblog",
    slug: 'simon-willison',
    sourceType: 'ATOM',
    authorityTier: 'SPECIALIST',
    homepageUrl: 'https://simonwillison.net/',
    feedUrl: 'https://simonwillison.net/atom/everything/',
    language: 'en',
    note: 'Recognised developer/AI-coding publication (Atom 1.0 wire format).',
  },
  {
    name: 'Next.js Releases',
    slug: 'nextjs-releases',
    sourceType: 'GITHUB',
    authorityTier: 'TRUSTED',
    homepageUrl: 'https://github.com/vercel/next.js/releases',
    feedUrl: null,
    language: 'en',
    sourceConfig: { owner: 'vercel', repo: 'next.js', prereleases: 'exclude' },
    note: 'GitHub Releases for a core web framework (official REST API, stable release ids).',
  },
  {
    name: 'Hacker News (Top)',
    slug: 'hacker-news-top',
    sourceType: 'HACKER_NEWS',
    authorityTier: 'COMMUNITY',
    homepageUrl: 'https://news.ycombinator.com/',
    feedUrl: null,
    language: 'en',
    sourceConfig: { mode: 'top', maxItems: 50 },
    note: 'Developer-community signal via the official Firebase API (story items only).',
  },
];
