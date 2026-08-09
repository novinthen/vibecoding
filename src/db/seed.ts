import { fileURLToPath } from 'node:url';

import { TOP_LEVEL_TOPIC_SEEDS } from '@/domain/topics';
import { TopicRepository } from '@/domain/repositories/topic-repository';

import { closePool, getPool, type Db } from './client';

/**
 * Seed controlled reference data.
 *
 * Currently seeds only the controlled top-level Topic taxonomy. Idempotent: safe
 * to run repeatedly (existing Topics are left untouched). Keep seeds limited to
 * genuinely controlled reference data — not sample/demo content.
 */
export async function seed(db: Db): Promise<{ topicsInserted: number }> {
  const topics = new TopicRepository(db);
  const topicsInserted = await topics.seedTopLevel(TOP_LEVEL_TOPIC_SEEDS);
  return { topicsInserted };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  seed(getPool())
    .then(async (result) => {
      console.log(
        `Seed complete. Top-level Topics inserted: ${result.topicsInserted} ` +
          `(of ${TOP_LEVEL_TOPIC_SEEDS.length}).`,
      );
      await closePool();
    })
    .catch(async (error: unknown) => {
      console.error((error as Error).message);
      await closePool();
      process.exit(1);
    });
}
