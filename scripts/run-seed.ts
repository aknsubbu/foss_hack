import 'dotenv/config';
import { runSeed } from '../src/db/seed';
import { runMigrations, pool } from '../src/db/client';
import { configureMeilisearch } from '../src/search/meilisearch';
import { redis } from '../src/cache/redis';
import { logger } from '../src/api/logger';

async function main(): Promise<void> {
  try {
    await redis.connect().catch(() => {
      // Redis connect may throw if already connected or using lazy connect
    });

    await runMigrations();
    logger.info('Migrations complete');

    await configureMeilisearch().catch((err) =>
      logger.warn({ err }, 'Meilisearch config warning — continuing'),
    );

    await runSeed();
  } finally {
    await pool.end();
    redis.disconnect();
    process.exit(0);
  }
}

main().catch((err) => {
  logger.error({ err }, 'Seed script failed');
  process.exit(1);
});
