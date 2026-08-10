import type { MetadataRoute } from 'next';

import { getActivePublication } from '@/public/request';

/**
 * Publication-aware robots directives. The host/sitemap are derived from the
 * request (never a hardcoded domain). `/admin` is never crawlable, and `/search`
 * result pages are kept out of the index (they carry no durable content).
 */
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const resolution = await getActivePublication();
  if (resolution.status === 'unresolved') {
    // Unrecognised production host: fail closed. Disallow everything and emit no
    // host-derived sitemap/host, so an arbitrary hostname is never advertised.
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  const { baseUrl } = resolution;
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/search'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
