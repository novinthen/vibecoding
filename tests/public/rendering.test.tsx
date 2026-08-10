import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ArticleRow, OutboundLink } from '@/app/(public)/_components/ui';
import type { PublicArticleListItem } from '@/public/types';

/**
 * Safe rendering of untrusted, feed-derived content on public pages. The portal
 * must never turn hostile feed input into executable markup or a dangerous link.
 */
function hostileArticle(): PublicArticleListItem {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: '<script>alert("xss")</script>Big News',
    excerpt: '<img src=x onerror=alert(1)> hostile excerpt',
    url: 'https://publisher.example/story',
    canonicalUrl: null,
    publishedAt: '2026-08-12T10:00:00Z',
    discoveredAt: '2026-08-12T10:00:00Z',
    sourceName: 'Publisher',
    sourceSlug: 'publisher',
    sourceHomepageUrl: 'https://publisher.example',
    authorityTier: 'TRUSTED',
    topicName: 'Models',
    topicSlug: 'models',
  };
}

describe('OutboundLink', () => {
  it('renders a javascript: URL as inert text, never a link', () => {
    const { container } = render(
      <OutboundLink href="javascript:alert(document.cookie)" />,
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders http(s) as a rel-hardened new-tab link', () => {
    const { container } = render(
      <OutboundLink href="https://example.com/x">Read →</OutboundLink>,
    );
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/x');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toContain('noopener');
    expect(anchor?.getAttribute('rel')).toContain('noreferrer');
    expect(anchor?.getAttribute('rel')).toContain('nofollow');
  });
});

describe('ArticleRow', () => {
  it('escapes hostile title/excerpt — no live script or img element', () => {
    const { container } = render(<ArticleRow article={hostileArticle()} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>');
    expect(container.textContent).toContain('Big News');
  });

  it('links the title to the internal Article detail route', () => {
    const { container } = render(<ArticleRow article={hostileArticle()} />);
    const internal = container.querySelector(
      'a[href="/article/11111111-1111-1111-1111-111111111111"]',
    );
    expect(internal).not.toBeNull();
  });

  it('provides a rel-hardened outbound link to the original source', () => {
    const { container } = render(<ArticleRow article={hostileArticle()} />);
    const outbound = container.querySelector(
      'a[href="https://publisher.example/story"]',
    );
    expect(outbound).not.toBeNull();
    expect(outbound?.getAttribute('rel')).toContain('nofollow');
  });
});
