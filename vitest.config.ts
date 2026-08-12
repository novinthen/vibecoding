import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    css: false,
    // Run test FILES sequentially (Stage 10). Several DB-gated integration
    // suites exercise PostgreSQL session-level advisory locks against a single
    // shared database using the SAME lock names (ingest/enrich/cluster/rank/
    // pipeline). Running those files in parallel makes them race for the same
    // lock and fail non-deterministically — a flaky regression gate is itself a
    // launch risk. Serialising files keeps the gate deterministic; tests within a
    // file still run normally. The suite is small, so the cost is modest.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
