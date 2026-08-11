#!/usr/bin/env tsx
/**
 * Stage 9A — CLI job runner.
 *
 * Command-line interface for running automated jobs. Supports individual jobs
 * (ingest, enrich, cluster, rank) and the full pipeline. Each job respects
 * locking to prevent overlapping runs.
 *
 * Usage:
 *   npm run jobs:ingest
 *   npm run jobs:enrich
 *   npm run jobs:cluster
 *   npm run jobs:rank
 *   npm run jobs:pipeline
 */

import { getPool } from '../src/db/client';
import {
  runClusteringJob,
  runEnrichmentJob,
  runIngestionJob,
  runJob,
  runPipelineJob,
  runRankingJob,
} from '../src/jobs';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.error('Usage: tsx scripts/run-job.ts <job-name>');
    console.error('Available jobs: ingest, enrich, cluster, rank, pipeline');
    process.exit(1);
  }

  const pool = getPool();

  try {
    let outcome;

    switch (command) {
      case 'ingest':
        console.log('[CLI] Running ingestion job...');
        outcome = await runJob('ingest', async (p) => runIngestionJob(p), {
          pool,
        });
        break;

      case 'enrich':
        console.log('[CLI] Running enrichment job...');
        outcome = await runJob('enrich', async (p) => runEnrichmentJob(p), {
          pool,
        });
        break;

      case 'cluster':
        console.log('[CLI] Running clustering job...');
        outcome = await runJob('cluster', async (p) => runClusteringJob(p), {
          pool,
        });
        break;

      case 'rank':
        console.log('[CLI] Running ranking job...');
        outcome = await runJob('rank', async (p) => runRankingJob(p), { pool });
        break;

      case 'pipeline':
        console.log('[CLI] Running full pipeline...');
        outcome = await runJob('pipeline', async (p) => runPipelineJob(p), {
          pool,
        });
        break;

      default:
        console.error(`Unknown job: ${command}`);
        console.error(
          'Available jobs: ingest, enrich, cluster, rank, pipeline',
        );
        process.exit(1);
    }

    // Print outcome summary.
    console.log(`\n[CLI] Job completed: ${outcome.kind}`);
    console.log(`  Status: ${outcome.result.status}`);
    console.log(`  Duration: ${outcome.result.durationMs}ms`);
    console.log(`  Attempted: ${outcome.result.attempted}`);
    console.log(`  Succeeded: ${outcome.result.succeeded}`);
    console.log(`  Skipped: ${outcome.result.skipped}`);
    console.log(`  Failed: ${outcome.result.failed}`);
    if (outcome.result.retryableFailures > 0) {
      console.log(`  Retryable failures: ${outcome.result.retryableFailures}`);
    }
    if (outcome.result.errorSummary) {
      console.log(`  Error summary: ${outcome.result.errorSummary}`);
    }

    // Exit with appropriate code.
    if (outcome.kind === 'SUCCESS') {
      process.exit(0);
    } else if (outcome.kind === 'PARTIAL') {
      console.warn('[CLI] Job completed with partial failures.');
      process.exit(0); // Partial is not a fatal error for scheduling
    } else {
      console.error('[CLI] Job failed.');
      process.exit(1);
    }
  } catch (error) {
    console.error('[CLI] Unexpected error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
