import type { FastifyInstance } from 'fastify';
import { pool } from '../../db/client';
import { redis } from '../../cache/redis';
import { checkMeilisearchHealth } from '../../search/meilisearch';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        description: 'Health check endpoint for all services',
        tags: ['Health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded'] },
              db: { type: 'string', enum: ['ok', 'error'] },
              redis: { type: 'string', enum: ['ok', 'error'] },
              search: { type: 'string', enum: ['ok', 'error'] },
            },
          },
        },
      },
    },
    async (_req, reply) => {
    const checks = await Promise.allSettled([
      pool.query('SELECT 1').then(() => 'ok').catch(() => 'error'),
      redis.ping().then(() => 'ok').catch(() => 'error'),
      checkMeilisearchHealth().then((ok) => (ok ? 'ok' : 'error')),
    ]);

    const [db, redisStatus, search] = checks.map((c) =>
      c.status === 'fulfilled' ? c.value : 'error',
    );

    const allOk = [db, redisStatus, search].every((s) => s === 'ok');

    return reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'ok' : 'degraded',
      db,
      redis: redisStatus,
      search,
    });
  });
}
