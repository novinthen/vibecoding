import type { Metadata } from 'next';
import Link from 'next/link';

import { buildMetadata } from '@/public/metadata';
import { requireServedPublication } from '@/public/request';

import { PageHeading } from '../_components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { config, baseUrl } = await requireServedPublication();
  return buildMetadata({
    config,
    baseUrl,
    path: '/about',
    title: 'About & sourcing',
    description: `What ${config.name} covers, how sources are selected, and how it credits original reporting.`,
  });
}

export default async function AboutPage() {
  const { config } = await requireServedPublication();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeading kicker="About" title={`About ${config.name}`} />

      <div className="space-y-6 text-[0.95rem] leading-relaxed text-neutral-700 dark:text-neutral-300">
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            What this covers
          </h2>
          <p>
            {config.name} is an independent intelligence portal for the
            vibe-coding ecosystem: AI coding tools, coding agents, AI-assisted
            IDEs, MCP and tool protocols, model developments that materially
            affect software development, important open-source projects, notable
            releases and changelogs, and significant developer-community
            signals. It is deliberately focused — it is not a general AI-news
            site.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            How sources are selected
          </h2>
          <p>
            Sources are chosen editorially and organised by authority tier —
            from <strong>primary</strong> sources (official company blogs,
            changelogs, and release notes) through <strong>trusted</strong> and{' '}
            <strong>specialist</strong> reporting to <strong>community</strong>{' '}
            and <strong>discovery</strong> signals. The current list of enabled
            sources is on the{' '}
            <Link
              href="/sources"
              className="text-sky-700 hover:underline dark:text-sky-400"
            >
              Sources
            </Link>{' '}
            page.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Original reporting vs. aggregation
          </h2>
          <p>
            This portal is a discovery and intelligence layer, not a
            republishing engine. It surfaces titles, short source-provided
            excerpts, and metadata, and links prominently to the original
            article at its publisher. It does not reproduce full copyrighted
            articles. The goal is to complement original reporting and send
            readers to it — never to replace it.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Attribution &amp; outbound links
          </h2>
          <p>
            Every item preserves its source&rsquo;s name, original publication
            time, and canonical URL, with a clear outbound link to the original
            reporting. Source facts are kept separate from any later derived
            intelligence, and machine-generated summaries, story clustering, and
            ranking are later stages — where they do not yet exist, this portal
            shows what it genuinely has rather than filling the gap with
            placeholders.
          </p>
        </section>
      </div>
    </div>
  );
}
