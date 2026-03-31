import type { FastifyInstance, FastifyRequest } from 'fastify';
import { browseIssues, getIssueById } from '../../db/client';

interface BrowseQuery {
  lang?: string | string[];
  difficulty?: string;
  type?: string;
  freshness?: string;
  mentored?: string;
  source?: string;
  page?: string;
  limit?: string;
  sort?: string;
}

export async function registerIssuesRoutes(app: FastifyInstance): Promise<void> {
  // GET /issues — paginated browse with filters
  app.get(
    '/issues',
    {
      schema: {
        description: 'Browse and filter open-source issues',
        tags: ['Issues'],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'string', description: 'Page number (default: 1)' },
            limit: { type: 'string', description: 'Results per page (default: 20, max: 100)' },
            lang: { 
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } }
              ],
              description: 'Filter by programming language' 
            },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Filter by difficulty' },
            type: { type: 'string', description: 'Filter by issue type' },
            freshness: { type: 'string', description: 'Filter by freshness' },
            mentored: { type: 'string', description: 'Filter by mentored status (true/false)' },
            source: { type: 'string', description: 'Filter by source (e.g., github)' },
            sort: { 
              type: 'string', 
              enum: ['created_at', 'updated_at', 'repo_health_score'],
              description: 'Sort by field' 
            },
          },
        },
      },
    },
    async (req: FastifyRequest<{ Querystring: BrowseQuery }>, reply) => {
      const q = req.query;

      const lang = q.lang
        ? Array.isArray(q.lang)
          ? q.lang
          : [q.lang]
        : undefined;

      const page = Math.max(parseInt(q.page ?? '1', 10), 1);
      const limit = Math.min(parseInt(q.limit ?? '20', 10), 100);

      const validSorts = ['created_at', 'updated_at', 'repo_health_score'];
      const sort = validSorts.includes(q.sort ?? '') ? q.sort : 'created_at';

      const { data, total } = await browseIssues({
        lang,
        difficulty: q.difficulty,
        type: q.type,
        freshness: q.freshness,
        mentored: q.mentored === 'true' ? true : undefined,
        source: q.source,
        page,
        limit,
        sort,
      });

      return reply.send({
        data,
        meta: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      });
    },
  );

  // GET /issues/:id — single issue by UUID
  app.get(
    '/issues/:id',
    {
      schema: {
        description: 'Get a single issue by UUID',
        tags: ['Issues'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Issue UUID' },
          },
          required: ['id'],
        },
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = req.params;

      // Basic UUID format validation
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        )
      ) {
        return reply.code(400).send({ error: 'Invalid ID format', statusCode: 400 });
      }

      const issue = await getIssueById(id);
      if (!issue) {
        return reply.code(404).send({ error: 'Issue not found', statusCode: 404 });
      }

      return reply.send(issue);
    },
  );
}
