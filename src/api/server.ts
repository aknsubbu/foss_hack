import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import cron from 'node-cron';
import { logger } from './logger';

export { logger };
import { runMigrations, pool } from '../db/client';
import { redis } from '../cache/redis';
import { configureMeilisearch } from '../search/meilisearch';
import { registerHealthRoutes } from './routes/health';
import { registerIssuesRoutes } from './routes/issues';
import { registerSearchRoutes } from './routes/search';
import { registerUsersRoutes } from './routes/users';
import { registerRecommendationsRoutes } from './routes/recommendations';
import { registerWebhookRoutes } from '../collectors/webhook-receiver';
import { runGithubPoller } from '../collectors/github-poller';
import { runAggregatorFetcher } from '../collectors/aggregator-fetcher';

const app = Fastify({ logger: false });

async function bootstrap(): Promise<void> {
  // Register plugins
  await app.register(cors, { origin: true });
  await app.register(helmet, { contentSecurityPolicy: false });

  // Register Swagger for API documentation
  await app.register(fastifySwagger, {
    swagger: {
      info: {
        title: 'FOSSHACK API',
        description: 'Open Source Issues Platform — Data Layer API',
        version: '1.0.0',
      },
      host: 'localhost:3000',
      schemes: ['http'],
      consumes: ['application/json'],
      produces: ['application/json'],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // Global error handler
  app.setErrorHandler((err, _req, reply) => {
    logger.error({ err }, 'Unhandled request error');
    reply.code(err.statusCode ?? 500).send({
      error: err.message,
      statusCode: err.statusCode ?? 500,
    });
  });

  // Run DB migrations on startup
  await runMigrations();
  logger.info('Database migrations complete');

  // Configure Meilisearch index settings
  await configureMeilisearch().catch((err) => {
    logger.warn({ err }, 'Meilisearch configuration failed — continuing without search');
  });

  // Connect Redis (lazy connect — make explicit)
  await redis.connect().catch((err) => {
    logger.warn({ err }, 'Redis initial connect warning — will retry');
  });

  // Register routes
  await registerHealthRoutes(app);
  await registerIssuesRoutes(app);
  await registerSearchRoutes(app);
  await registerUsersRoutes(app);
  await registerRecommendationsRoutes(app);
  registerWebhookRoutes(app);

  // Register scheduled jobs
  registerCronJobs();

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'FOSSHACK API server started');
}

function registerCronJobs(): void {
  // GitHub GraphQL poller — every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    logger.info({ module: 'cron', job: 'github-poller' }, 'Collector started');
    runGithubPoller().catch((err) =>
      logger.error({ err, module: 'cron:github-poller' }, 'Poller failed'),
    );
  });

  // Aggregator fetcher — daily at 02:00
  cron.schedule('0 2 * * *', () => {
    logger.info({ module: 'cron', job: 'aggregator-fetcher' }, 'Collector started');
    runAggregatorFetcher().catch((err) =>
      logger.error({ err, module: 'cron:aggregator-fetcher' }, 'Aggregator failed'),
    );
  });

  // Stale issue scanner — daily at 03:00
  cron.schedule('0 3 * * *', async () => {
    logger.info({ module: 'cron', job: 'stale-scanner' }, 'Scanning stale issues');
    try {
      await pool.query(`
        UPDATE issues
        SET freshness_label = 'stale'
        WHERE state = 'open'
          AND days_since_activity > 180
          AND freshness_label != 'stale'
      `);
    } catch (err) {
      logger.error({ err, module: 'cron:stale-scanner' }, 'Stale scan failed');
    }
  });

  // Closed issue sweeper — every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    logger.info({ module: 'cron', job: 'closed-sweeper' }, 'Sweeping closed issues');
    try {
      // Mark very old unverified open issues as needing verification
      // Full implementation uses GitHub API to batch-verify — simplified here
      await pool.query(`
        UPDATE issues
        SET freshness_label = 'stale'
        WHERE state = 'open'
          AND updated_at < NOW() - INTERVAL '6 months'
      `);
    } catch (err) {
      logger.error({ err, module: 'cron:closed-sweeper' }, 'Closed sweeper failed');
    }
  });

  // Repo attribute extractor — daily at 04:00
  cron.schedule('0 4 * * *', async () => {
    logger.info({ module: 'cron', job: 'repo-attributes' }, 'Repo attribute extraction started');
    try {
      const { runRepoAttributeExtractor } = await import('../enrichment/repo-attributes');
      await runRepoAttributeExtractor();
    } catch (err) {
      logger.error({ err, module: 'cron:repo-attributes' }, 'Repo attribute extraction failed');
    }
  });

  // Re-enrichment runner — weekly Sunday at 01:00
  cron.schedule('0 1 * * 0', async () => {
    logger.info({ module: 'cron', job: 're-enrich' }, 'Weekly re-enrichment started');
    try {
      const { reEnrichQueue } = await import('../queue/queues');
      const res = await pool.query(
        `SELECT url FROM issues WHERE enriched_at < NOW() - INTERVAL '7 days' OR enriched_at IS NULL LIMIT 1000`,
      );
      for (const row of res.rows) {
        await reEnrichQueue.add('re-enrich', { issueUrl: row.url as string });
      }
      logger.info(
        { count: res.rows.length, module: 'cron:re-enrich' },
        'Re-enrichment jobs queued',
      );
    } catch (err) {
      logger.error({ err, module: 'cron:re-enrich' }, 'Re-enrichment scheduling failed');
    }
  });

  logger.info({ module: 'cron' }, 'All cron jobs registered');
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  logger.info('Shutting down gracefully...');
  await app.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

bootstrap().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
