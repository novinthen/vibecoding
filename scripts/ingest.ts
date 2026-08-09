import { fileURLToPath } from 'node:url';

import { closePool, getPool } from '@/db/client';
import {
  ArticleRepository,
  SourceFetchRepository,
  SourceRepository,
} from '@/domain';
import type { SourceRow } from '@/domain/types';
import {
  ingestSource,
  ingestSources,
  REPRESENTATIVE_SOURCES,
  type IngestDeps,
  type IngestResult,
} from '@/ingestion';

/**
 * Manual / CLI ingestion entry point.
 *
 * A thin operational seam for testing ingestion against specific Sources —
 * deliberately not a production scheduler (out of Stage 3 scope). Requires
 * DATABASE_URL and hits the network via the real safe fetcher.
 *
 *   npm run ingest -- --register           Upsert the representative Sources.
 *   npm run ingest -- --list               List configured Sources.
 *   npm run ingest -- --source <slug>      Ingest one Source by slug.
 *   npm run ingest -- --all                Ingest every enabled Source.
 */

interface Cli {
  register: boolean;
  list: boolean;
  all: boolean;
  slug: string | null;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): Cli {
  const cli: Cli = {
    register: false,
    list: false,
    all: false,
    slug: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--register':
        cli.register = true;
        break;
      case '--list':
        cli.list = true;
        break;
      case '--all':
        cli.all = true;
        break;
      case '--source':
        cli.slug = argv[i + 1] ?? null;
        i += 1;
        break;
      case '--help':
      case '-h':
        cli.help = true;
        break;
      default:
        // Ignore unknown flags rather than failing the whole run.
        break;
    }
  }
  return cli;
}

const USAGE = `Ingestion CLI
  --register           Upsert the representative Source registry
  --list               List configured Sources and their health
  --source <slug>      Ingest a single Source by slug
  --all                Ingest every enabled Source
  --help               Show this help`;

function formatResult(source: SourceRow, r: IngestResult): string {
  if (r.status === 'FAILED') {
    return `  ✗ ${source.slug}: FAILED (${r.errorCode}) ${r.errorMessage}`;
  }
  if (r.notModified) {
    return `  = ${source.slug}: not modified (304), ${r.durationMs}ms`;
  }
  return (
    `  ✓ ${source.slug}: ${r.status} found=${r.itemsFound} new=${r.itemsNew} ` +
    `existing=${r.itemsExisting} skipped=${r.itemsSkipped} ${r.durationMs}ms`
  );
}

async function run(cli: Cli): Promise<number> {
  if (cli.help || (!cli.register && !cli.list && !cli.all && !cli.slug)) {
    console.log(USAGE);
    return 0;
  }

  const pool = getPool();
  const sources = new SourceRepository(pool);
  const deps: IngestDeps = {
    articles: new ArticleRepository(pool),
    sourceFetches: new SourceFetchRepository(pool),
    sources,
  };

  if (cli.register) {
    let count = 0;
    for (const entry of REPRESENTATIVE_SOURCES) {
      await sources.upsertBySlug(entry);
      count += 1;
    }
    console.log(`Registered ${count} representative Source(s).`);
  }

  if (cli.list) {
    const enabled = await sources.listEnabled();
    console.log(`Enabled Sources (${enabled.length}):`);
    for (const s of enabled) {
      console.log(
        `  - ${s.slug} [${s.source_type}/${s.authority_tier}] ` +
          `health=${s.health_status} failures=${s.failure_count}`,
      );
    }
  }

  if (cli.slug) {
    const source = await sources.findBySlug(cli.slug);
    if (!source) {
      console.error(`No Source with slug "${cli.slug}".`);
      return 1;
    }
    const r = await ingestSource(source, deps);
    console.log('Ingestion result:');
    console.log(formatResult(source, r));
    return r.status === 'FAILED' ? 1 : 0;
  }

  if (cli.all) {
    const enabled = await sources.listEnabled();
    const results = await ingestSources(enabled, deps);
    console.log(`Ingested ${results.length} Source(s):`);
    const byId = new Map(enabled.map((s) => [s.id, s]));
    let failures = 0;
    for (const r of results) {
      const source = byId.get(r.sourceId);
      if (source) console.log(formatResult(source, r));
      if (r.status === 'FAILED') failures += 1;
    }
    return failures > 0 ? 1 : 0;
  }

  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  run(parseArgs(process.argv.slice(2)))
    .then(async (code) => {
      await closePool();
      process.exit(code);
    })
    .catch(async (error: unknown) => {
      console.error((error as Error).message);
      await closePool();
      process.exit(1);
    });
}
