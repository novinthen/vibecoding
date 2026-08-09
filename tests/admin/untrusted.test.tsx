import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ExternalUrl, UntrustedText } from '@/app/admin/_components/untrusted';

/**
 * Safe-rendering guarantees for untrusted, feed-derived content.
 *
 * These assert the admin never turns hostile feed input into executable markup
 * or a dangerous link — the core of the Stage 4 "do not render arbitrary feed
 * HTML unsafely" requirement.
 */
describe('untrusted content rendering', () => {
  it('renders a malicious excerpt as inert escaped text, not markup', () => {
    const hostile = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const { container } = render(<UntrustedText value={hostile} />);
    // No live script/img element was created — it is all text.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>');
  });

  it('renders a javascript: URL as text, never as a link', () => {
    const { container } = render(
      <ExternalUrl value="javascript:alert(document.cookie)" />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('javascript:');
  });

  it('renders an http(s) URL as a rel-hardened new-tab link', () => {
    const { container } = render(<ExternalUrl value="https://example.com/x" />);
    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('https://example.com/x');
    expect(anchor?.getAttribute('rel')).toContain('noopener');
    expect(anchor?.getAttribute('rel')).toContain('noreferrer');
    expect(anchor?.getAttribute('target')).toBe('_blank');
  });
});
