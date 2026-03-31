import 'dotenv/config';
import { runGithubPoller } from '../src/collectors/github-poller';
import { redis } from '../src/cache/redis';
import { logger } from '../src/api/logger';

async function main(): Promise<void> {
  try {
    await redis.connect().catch(() => {});
    logger.info('Manual poller trigger started');
    await runGithubPoller();
  } finally {
    redis.disconnect();
    process.exit(0);
  }
}

main().catch((err) => {
  logger.error({ err }, 'Poller script failed');
  process.exit(1);
});
