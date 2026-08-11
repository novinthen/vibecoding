/**
 * Stage 9A — Job orchestration layer (public surface).
 *
 * Exports all job implementations, the runner, types, and utilities for
 * production automation. Individual jobs can be run independently or
 * orchestrated through the pipeline.
 */

export { runJob, buildJobResult } from './job-runner';
export { tryAcquireJobLock, type JobLock } from './locking';
export { JobRunRepository } from './job-run-repository';
export { runIngestionJob, type IngestionJobOptions } from './ingestion-job';
export { runEnrichmentJob, type EnrichmentJobOptions } from './enrichment-job';
export { runClusteringJob, type ClusteringJobOptions } from './clustering-job';
export { runRankingJob, type RankingJobOptions } from './ranking-job';
export {
  runPipelineWithLock,
  runPipelineJob,
  type PipelineJobOptions,
} from './pipeline-job';
export type { JobStatus, JobResult, JobOutcome, ItemFailure } from './types';
