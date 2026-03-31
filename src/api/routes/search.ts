import type { FastifyInstance, FastifyRequest } from 'fastify';
import { searchIssues } from '../../search/meilisearch';

interface SearchQuery {
  q?: string;
  lang?: string | string[];
  difficulty?: string;
  type?: string;
  limit?: string;
  offset?: string;
}

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/search',
    {
      schema: {
        description: 'Search for open-source issues using full-text search',
        tags: ['Search'],
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Search query (required, min 2 characters)' },
            lang: { 
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } }
              ],
              description: 'Filter by programming language' 
            },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Filter by difficulty' },
            type: { type: 'string', description: 'Filter by issue type' },
            limit: { type: 'string', description: 'Results per page (default: 20, max: 100)' },
            offset: { type: 'string', description: 'Pagination offset (default: 0)' },
          },
          required: ['q'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    url: { type: 'string' },
                  },
                },
              },
            },
          },
          400: { type: 'object', properties: { error: { type: 'string' }, statusCode: { type: 'number' } } },
        },
      },
    },
    async (req: FastifyRequest<{ Querystring: SearchQuery }>, reply) => {
      const { q, lang, difficulty, type, limit: limitStr, offset: offsetStr } =
        req.query;

      if (!q || q.trim().length < 2) {
        return reply.code(400).send({
          error: 'Query parameter `q` is required and must be at least 2 characters',
          statusCode: 400,
        });
      }

      const limit = Math.min(parseInt(limitStr ?? '20', 10), 100);
      const offset = Math.max(parseInt(offsetStr ?? '0', 10), 0);

      const result = await searchIssues({
        q: q.trim(),
        lang,
        difficulty,
        type,
        limit,
        offset,
      });

      return reply.send(result);
    },
  );
}
