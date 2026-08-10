import type {
  LocalizationStatus,
  PublicationStatus,
  PublicationStoryStatus,
} from '@/domain/enums';

import { Badge } from '../../_components/ui';

/**
 * Status badges for the Stage 5B editorial surfaces. Server-safe (no client
 * hooks); each maps a controlled status value to a restrained tone.
 */

const GOOD =
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
const WARN =
  'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
const MUTED =
  'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
const INFO = 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300';

export function PublicationStatusBadge({
  status,
}: {
  readonly status: PublicationStatus;
}) {
  const tone =
    status === 'ACTIVE' ? GOOD : status === 'INACTIVE' ? WARN : MUTED;
  return <Badge className={tone}>{status}</Badge>;
}

export function PublicationStoryStatusBadge({
  status,
}: {
  readonly status: PublicationStoryStatus;
}) {
  const tone =
    status === 'PUBLISHED'
      ? GOOD
      : status === 'SCHEDULED'
        ? INFO
        : status === 'DRAFT'
          ? WARN
          : MUTED;
  return <Badge className={tone}>{status}</Badge>;
}

export function LocalizationStatusBadge({
  status,
}: {
  readonly status: LocalizationStatus;
}) {
  const tone =
    status === 'PUBLISHED'
      ? GOOD
      : status === 'REVIEW'
        ? INFO
        : status === 'DRAFT'
          ? WARN
          : MUTED;
  return <Badge className={tone}>{status}</Badge>;
}
