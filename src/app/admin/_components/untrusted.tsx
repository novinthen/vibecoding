import { safeExternalUrl } from '@/admin/safe-url';

/**
 * Render an untrusted, feed-derived URL. Safe http(s) values become a
 * rel-hardened, new-tab link; anything else (javascript:, data:, garbage) is
 * rendered as escaped text and is never clickable. React escapes the text child
 * either way, so no untrusted markup can execute.
 */
export function ExternalUrl({ value }: { readonly value: string | null }) {
  const safe = safeExternalUrl(value);
  if (!safe) {
    return <span className="break-all">{value ?? '—'}</span>;
  }
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="break-all font-medium text-sky-700 hover:underline dark:text-sky-400"
    >
      {safe}
    </a>
  );
}

/**
 * Render untrusted text (title, excerpt) as escaped text. A thin, explicit
 * wrapper so the intent — "this is untrusted, never dangerouslySetInnerHTML" —
 * is visible at the call site and testable.
 */
export function UntrustedText({
  value,
  className,
}: {
  readonly value: string | null;
  readonly className?: string;
}) {
  return <span className={className}>{value ?? ''}</span>;
}
