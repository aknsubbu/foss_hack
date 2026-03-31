import type { FastifyInstance } from 'fastify';
import { getRecommendations, getSimilarIssues } from '../../users/matching';
import { logger } from '../logger';

export async function registerRecommendationsRoutes(app: FastifyInstance): Promise<void> {
  // GET /users/:id/recommendations
  app.get<{
    Params: { id: string };
    Querystring: {
      limit?: number;
      freshness?: string;
      type?: string;
      mentored?: string;
      min_gfi_quality?: number;
    };
  }>(
    '/users/:id/recommendations',
    {
      schema: {
        description: 'Get personalized issue recommendations for a developer',
        tags: ['recommendations'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'number', minimum: 1, maximum: 50, default: 20 },
            freshness: { type: 'string', enum: ['fresh', 'active', 'stale'] },
            type: { type: 'string' },
            mentored: { type: 'string', enum: ['true', 'false'] },
            min_gfi_quality: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const result = await getRecommendations(req.params.id, {
          limit: req.query.limit,
          freshness: req.query.freshness,
          type: req.query.type,
          mentored: req.query.mentored === 'true',
          minGfiQuality: req.query.min_gfi_quality,
        });
        return reply.send(result);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('not found')) {
          return reply.code(404).send({ error: 'User not found' });
        }
        logger.error({ err, userId: req.params.id, module: 'route:recommendations' }, 'Recommendations failed');
        return reply.code(500).send({ error: 'Failed to compute recommendations' });
      }
    },
  );

  // GET /issues/similar/:id
  app.get<{
    Params: { id: string };
    Querystring: { limit?: number };
  }>(
    '/issues/similar/:id',
    {
      schema: {
        description: 'Find issues semantically similar to a given issue (vector search)',
        tags: ['issues'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'number', minimum: 1, maximum: 20, default: 10 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const issues = await getSimilarIssues(req.params.id, req.query.limit);
        return reply.send({ data: issues, total: issues.length });
      } catch (err) {
        logger.error({ err, issueId: req.params.id, module: 'route:similar' }, 'Similar issues failed');
        return reply.code(500).send({ error: 'Failed to find similar issues' });
      }
    },
  );
}
