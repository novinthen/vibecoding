import type { Metadata } from 'next';

import type { AuthorityTier } from '@/domain/enums';
import { getSources } from '@/public/content';
import { getDb, isDatabaseConfigured } from '@/public/db';
import { buildMetadata } from '@/public/metadata';
import { getActivePublication } from '@/public/request';
import type { PublicSource } from '@/public/types';

import {
  AuthorityBadge,
  DataUnavailable,
  EmptyState,
  OutboundLink,
  PageHeading,
} from '../_components/ui';

export const dynamic = 'force-dynamic';

// Order tiers by editorial authority for display.
const TIER_ORDER: readonly AuthorityTier[] = [
  'PRIMARY',
  'TRUSTED',
  'SPECIALIST',
  'COMMUNITY',
  'DISCOVERY',
];

const TIER_LABEL: Record<AuthorityTier, string> = {
  PRIMARY: 'Primary sources',
  TRUSTED: 'Trusted reporting',
  SPECIALIST: 'Specialist',
  COMMUNITY: 'Community',
  DISCOVERY: 'Discovery',
};

export async function generateMetadata(): Promise<Metadata> {
  const { config, baseUrl } = await getActivePublication();
  return buildMetadata({
    config,
    baseUrl,
    path: '/sources',
    title: 'Sources',
    description: `The enabled sources ${config.name} aggregates, grouped by editorial authority tier.`,
  });
}

export default async function SourcesPage() {
  return (
    <>
      <PageHeading
        kicker="Provenance"
        title="Sources"
        description="Enabled public sources, grouped by editorial authority. Counts reflect currently visible articles."
      />
      {!isDatabaseConfigured() ? <DataUnavailable /> : <SourcesByTier />}
    </>
  );
}

async function SourcesByTier() {
  const sources = await getSources(getDb());
  if (sources.length === 0) {
    return <EmptyState>No public sources are enabled yet.</EmptyState>;
  }
  const byTier = new Map<AuthorityTier, PublicSource[]>();
  for (const source of sources) {
    const bucket = byTier.get(source.authorityTier) ?? [];
    bucket.push(source);
    byTier.set(source.authorityTier, bucket);
  }

  return (
    <div className="space-y-8">
      {TIER_ORDER.filter((tier) => byTier.has(tier)).map((tier) => (
        <section key={tier}>
          <div className="mb-2 flex items-center gap-2 border-b border-neutral-200 pb-2 dark:border-neutral-800">
            <AuthorityBadge tier={tier} />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
              {TIER_LABEL[tier]}
            </h2>
          </div>
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {(byTier.get(tier) ?? []).map((source) => (
              <li
                key={source.slug}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div>
                  <span className="font-medium">{source.name}</span>
                  {source.homepageUrl ? (
                    <span className="ml-2 text-xs text-neutral-500">
                      <OutboundLink href={source.homepageUrl} />
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-neutral-400">
                  {source.articleCount} article
                  {source.articleCount === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
