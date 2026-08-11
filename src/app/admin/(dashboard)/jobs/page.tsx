/**
 * Stage 9A — Admin job runs page.
 *
 * Provides read-only visibility into automated job execution history.
 * Shows recent runs, status, timing, and error summaries for operational monitoring.
 */

import { Suspense } from 'react';

import { requireAdmin } from '@/admin/auth/guard';
import { getPool } from '@/db/client';
import { JobRunRepository } from '@/jobs/job-run-repository';

export const metadata = {
  title: 'Job Runs — Admin',
};

export default async function JobRunsPage() {
  // Any authenticated admin (including VIEWER) can view job runs.
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Job Runs</h1>
        <p className="text-sm text-gray-600 mt-1">
          Automated job execution history and status
        </p>
      </div>

      <Suspense fallback={<div>Loading job runs...</div>}>
        <JobRunsList />
      </Suspense>
    </div>
  );
}

async function JobRunsList() {
  const pool = getPool();
  const repo = new JobRunRepository(pool);

  const recentRuns = await repo.listRecentRuns(50);

  if (recentRuns.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center text-gray-500">
        No job runs found. Jobs will appear here after the first automated run.
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Job
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Started
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Duration
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Results
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Error
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {recentRuns.map((run) => (
            <tr key={run.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm font-medium text-gray-900">
                {run.job_name}
              </td>
              <td className="px-4 py-3 text-sm">
                <JobStatusBadge status={run.status} />
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {formatTimestamp(run.started_at)}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {formatDuration(run.duration_ms)}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">
                {run.succeeded}/{run.attempted}
                {run.failed > 0 && (
                  <span className="text-red-600 ml-2">
                    ({run.failed} failed)
                  </span>
                )}
                {run.skipped > 0 && (
                  <span className="text-gray-400 ml-2">
                    ({run.skipped} skipped)
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500 max-w-md truncate">
                {run.error_summary || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  const colors = {
    RUNNING: 'bg-blue-100 text-blue-800',
    SUCCEEDED: 'bg-green-100 text-green-800',
    PARTIAL: 'bg-yellow-100 text-yellow-800',
    FAILED: 'bg-red-100 text-red-800',
    SKIPPED: 'bg-gray-100 text-gray-800',
  };

  const color = colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800';

  return (
    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${color}`}>
      {status}
    </span>
  );
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—';
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
}
