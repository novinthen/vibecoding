/** @type {import('next').NextConfig} */

/**
 * Baseline security response headers applied to every route (Stage 10).
 *
 * These are conservative, high-value, framework-safe hardening headers — they do
 * not risk breaking Next.js hydration the way a strict `Content-Security-Policy`
 * would (a full CSP with nonces is documented as deferred hardening in
 * docs/OPERATIONS.md). HSTS is emitted unconditionally; browsers ignore it over
 * plain HTTP, so it only takes effect on HTTPS deployments.
 */
const securityHeaders = [
  // Never allow the browser to MIME-sniff a response into a different type.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Clickjacking protection — nothing here is meant to be framed (esp. /admin).
  { key: 'X-Frame-Options', value: 'DENY' },
  // Do not leak full referrer URLs cross-origin.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable powerful features the portal does not use.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  // Enforce HTTPS for a year once seen over TLS (ignored over HTTP).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
