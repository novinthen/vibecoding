import { describe, expect, it } from 'vitest';

import {
  assertPublicUrl,
  assertSafeUrlShape,
  IngestError,
  isPrivateAddress,
} from '@/ingestion';

describe('isPrivateAddress', () => {
  it('flags loopback, private, link-local, and CGNAT IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.1.1',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
      '0.0.0.0',
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it('allows ordinary public IPv4', () => {
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('flags loopback, unique-local, link-local, and mapped IPv6', () => {
    for (const ip of [
      '::1',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });
});

describe('isPrivateAddress — IPv4-mapped IPv6 normalization bypasses', () => {
  it('blocks dotted IPv4-mapped loopback', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('blocks hexadecimal IPv4-mapped loopback (same address, different text)', () => {
    // ::ffff:7f00:1 is the hex-normalized form of ::ffff:127.0.0.1.
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    // Fully-expanded form must also be caught.
    expect(isPrivateAddress('0:0:0:0:0:ffff:7f00:0001')).toBe(true);
  });

  it('blocks mapped RFC1918 / private addresses in either notation', () => {
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateAddress('::ffff:c0a8:0101')).toBe(true); // 192.168.1.1 in hex
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true); // cloud metadata
    expect(isPrivateAddress('::ffff:a9fe:a9fe')).toBe(true); // same, hex
  });

  it('blocks IPv4-compatible (::a.b.c.d) embedded loopback', () => {
    expect(isPrivateAddress('::7f00:1')).toBe(true); // ::127.0.0.1
    expect(isPrivateAddress('::127.0.0.1')).toBe(true);
  });

  it('allows mapped PUBLIC IPv4 addresses (genuinely public)', () => {
    expect(isPrivateAddress('::ffff:93.184.216.34')).toBe(false);
    expect(isPrivateAddress('::ffff:5db8:d822')).toBe(false); // same, hex
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('classifies ordinary IPv6 forms', () => {
    // Public global-unicast.
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
    expect(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
    // Reserved / non-routable.
    expect(isPrivateAddress('::')).toBe(true); // unspecified
    expect(isPrivateAddress('::1')).toBe(true); // loopback
    expect(isPrivateAddress('febf::1')).toBe(true); // upper bound of fe80::/10
    expect(isPrivateAddress('fdff:ffff::1')).toBe(true); // fc00::/7 unique-local
    expect(isPrivateAddress('ff02::1')).toBe(true); // multicast
    expect(isPrivateAddress('64:ff9b::7f00:1')).toBe(true); // NAT64 reserved
  });

  it('rejects a URL whose IPv6 host is a mapped private address', async () => {
    // Structural literal check must catch it without any DNS lookup.
    await expect(
      assertPublicUrl('http://[::ffff:7f00:1]/feed', {
        resolve: async () => {
          throw new Error('resolver must not be called for a literal IP');
        },
      }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });
});

describe('assertSafeUrlShape', () => {
  it('rejects non-http(s) schemes', () => {
    expect(() => assertSafeUrlShape('ftp://example.com')).toThrow(IngestError);
    expect(() => assertSafeUrlShape('file:///etc/passwd')).toThrow(IngestError);
  });

  it('rejects embedded credentials', () => {
    expect(() => assertSafeUrlShape('https://user:pass@example.com')).toThrow(
      /credentials/,
    );
  });

  it('rejects obvious internal hostnames', () => {
    expect(() => assertSafeUrlShape('http://localhost/x')).toThrow(IngestError);
    expect(() => assertSafeUrlShape('http://db.internal/x')).toThrow(
      IngestError,
    );
  });

  it('rejects literal private IPs without DNS', () => {
    expect(() =>
      assertSafeUrlShape('http://169.254.169.254/latest/meta-data'),
    ).toThrow(/private/);
  });

  it('accepts a well-formed public URL', () => {
    expect(assertSafeUrlShape('https://example.com/feed').hostname).toBe(
      'example.com',
    );
  });
});

describe('assertPublicUrl (with injected resolver)', () => {
  it('rejects a host that resolves to a private address', async () => {
    const resolve = async () => ['10.1.2.3'];
    await expect(
      assertPublicUrl('https://evil.example.com/feed', { resolve }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('accepts a host that resolves to public addresses', async () => {
    const resolve = async () => ['93.184.216.34'];
    const url = await assertPublicUrl('https://example.com/feed', { resolve });
    expect(url.hostname).toBe('example.com');
  });

  it('rejects when any resolved address is private (mixed set)', async () => {
    const resolve = async () => ['93.184.216.34', '127.0.0.1'];
    await expect(
      assertPublicUrl('https://example.com/feed', { resolve }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('surfaces resolution failure as a retryable NETWORK error', async () => {
    const resolve = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(
      assertPublicUrl('https://nope.example.com/feed', { resolve }),
    ).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('does not resolve literal IPs (validated structurally)', async () => {
    const url = await assertPublicUrl('https://93.184.216.34/feed', {
      resolve: async () => {
        throw new Error('should not be called');
      },
    });
    expect(url.hostname).toBe('93.184.216.34');
  });
});
