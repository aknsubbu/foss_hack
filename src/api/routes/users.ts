import type { FastifyInstance } from 'fastify';
import { onboardUser } from '../../users/onboarding';
import { getUserById } from '../../db/users';
import { logger } from '../logger';
import type { OnboardingInput } from '../../types/issue';

export async function registerUsersRoutes(app: FastifyInstance): Promise<void> {
  // POST /users — onboard a new user
  app.post<{ Body: OnboardingInput }>(
    '/users',
    {
      schema: {
        description: 'Onboard a new developer — extracts profile tags via LLM and generates embedding',
        tags: ['users'],
        body: {
          type: 'object',
          properties: {
            githubUsername: { type: 'string', description: 'GitHub username (optional)' },
            prompt: { type: 'string', description: 'Free-text: what are you looking for? (optional)' },
            techStack: { type: 'array', items: { type: 'string' } },
            domains: {
              type: 'array',
              items: { type: 'string' },
              description: 'Interested domains: frontend, backend, devtools, infrastructure, ml, mobile, database, security, testing, docs',
            },
            experienceLevel: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
            preferredDifficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            preferredTypes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (req, reply) => {
      const input = req.body;

      if (!input.githubUsername && !input.prompt && !input.techStack?.length) {
        return reply.code(400).send({
          error: 'At least one of githubUsername, prompt, or techStack is required',
        });
      }

      try {
        const user = await onboardUser(input);
        return reply.code(201).send(user);
      } catch (err) {
        logger.error({ err, module: 'route:users' }, 'User onboarding failed');
        return reply.code(500).send({ error: 'Failed to create user profile' });
      }
    },
  );

  // GET /users/:id — fetch user profile
  app.get<{ Params: { id: string } }>(
    '/users/:id',
    {
      schema: {
        description: 'Fetch a developer profile by ID',
        tags: ['users'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
    },
    async (req, reply) => {
      const user = await getUserById(req.params.id);
      if (!user) return reply.code(404).send({ error: 'User not found' });
      return reply.send(user);
    },
  );

  // PUT /users/:id — update user profile (re-runs onboarding pipeline)
  app.put<{ Params: { id: string }; Body: OnboardingInput }>(
    '/users/:id',
    {
      schema: {
        description: 'Update a developer profile — re-extracts tags and regenerates embedding',
        tags: ['users'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            githubUsername: { type: 'string' },
            prompt: { type: 'string' },
            techStack: { type: 'array', items: { type: 'string' } },
            domains: { type: 'array', items: { type: 'string' } },
            experienceLevel: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
            preferredDifficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            preferredTypes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (req, reply) => {
      const existing = await getUserById(req.params.id);
      if (!existing) return reply.code(404).send({ error: 'User not found' });

      const input: OnboardingInput = {
        githubUsername: req.body.githubUsername ?? existing.githubUsername,
        prompt: req.body.prompt,
        techStack: req.body.techStack ?? existing.techStack,
        domains: req.body.domains ?? existing.domains,
        experienceLevel: req.body.experienceLevel ?? existing.experienceLevel,
        preferredDifficulty: req.body.preferredDifficulty ?? existing.preferredDifficulty,
        preferredTypes: req.body.preferredTypes ?? existing.preferredTypes,
      };

      try {
        const updated = await onboardUser(input);
        return reply.send(updated);
      } catch (err) {
        logger.error({ err, userId: req.params.id, module: 'route:users' }, 'User update failed');
        return reply.code(500).send({ error: 'Failed to update user profile' });
      }
    },
  );
}
