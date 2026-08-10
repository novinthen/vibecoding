import { PublicContentRepository } from '@/domain';
import { getDb, isDatabaseConfigured } from '@/public/db';
import { buildAtomFeed } from '@/public/feed';
import { getActivePublication } from '@/public/request';

/**
 * Publication-aware Atom feed (`/feed.xml`).
 *
 * The feed is scoped to the resolved Publication: its domain, its PUBLISHED
 * Story selection, its editorial copy, and its default-locale metadata. An
 * unresolved production host fails closed (404), matching the rest of the public
 * surface — no feed is ever built from an unvalidated hostname. The in-code
 * default Publication (local/preview) and any Publication with no published
 * Stories yield an honest empty feed rather than fabricated entries.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const resolution = await getActivePublication();
  if (resolution.status === 'unresolved') {
    return new Response('Not found', { status: 404 });
  }

  const { config, baseUrl } = resolution;
  const publicationId = resolution.status === 'database' ? config.id : null;

  let stories: Awaited<
    ReturnType<PublicContentRepository['listPublishedStoriesForPublication']>
  > = [];
  if (isDatabaseConfigured() && publicationId) {
    try {
      stories = await new PublicContentRepository(
        getDb(),
      ).listPublishedStoriesForPublication(publicationId, { limit: 50 });
    } catch {
      // A data-layer failure yields an honest empty feed, never a 500.
      stories = [];
    }
  }

  const xml = buildAtomFeed({
    siteName: config.name,
    baseUrl,
    locale: config.locale,
    description: config.tagline ?? config.description,
    stories,
  });

  return new Response(xml, {
    headers: {
      'content-type': 'application/atom+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
