import crypto from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { rawIssuesQueue, closedIssuesQueue } from '../queue/queues';
import { logger } from '../api/logger';
import type { RawIssue } from '../types/issue';
import { pool } from '../db/client';

interface GithubWebhookIssuePayload {
  action: string;
  issue: {
    number: number;
    html_url: string;
    title: string;
    body: string;
    state: string;
    created_at: string;
    updated_at: string;
    closed_at?: string;
    user?: { login: string };
    comments: number;
    labels: Array<{ name: string }>;
  };
  repository?: {
    full_name: string;
  };
}

function validateHmacSignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

  if (signature.length !== expected.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

async function isTrackedRepo(repoSlug: string): Promise<boolean> {
  const res = await pool.query('SELECT 1 FROM repos WHERE slug = $1 LIMIT 1', [
    repoSlug.toLowerCase(),
  ]);
  return res.rowCount! > 0;
}

async function refetchAndEmit(
  repoSlug: string,
  issueNumber: number,
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  const res = await fetch(
    `https://api.github.com/repos/${repoSlug}/issues/${issueNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!res.ok) return;

  const issue = (await res.json()) as Record<string, unknown>;
  const raw: RawIssue = {
    url: issue.html_url as string,
    externalId: String(issue.number),
    title: issue.title as string,
    bodyRaw: (issue.body as string) ?? '',
    source: 'github',
    repoSlug,
    labels: ((issue.labels as Array<{ name: string }>) ?? []).map((l) => l.name),
    state: (issue.state as 'open' | 'closed') ?? 'open',
    createdAt: new Date(issue.created_at as string),
    updatedAt: new Date(issue.updated_at as string),
    closedAt: issue.closed_at ? new Date(issue.closed_at as string) : undefined,
    author:
      (issue.user as Record<string, unknown> | undefined)?.login as string ?? 'unknown',
    commentsCount: (issue.comments as number) ?? 0,
    rawJson: issue,
  };

  await rawIssuesQueue.add('issue', { issue: raw });
}

// Register webhook route on the Fastify instance
export function registerWebhookRoutes(app: FastifyInstance): void {
  // Add content type parser to get raw body for HMAC validation
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        const json = JSON.parse(body.toString()) as unknown;
        // Attach raw body to request for HMAC validation
        (req as FastifyRequest & { rawBody: Buffer }).rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
        done(null, json);
      } catch (err) {
        done(err as Error);
      }
    },
  );

  app.post(
    '/webhooks/github',
    async (
      req: FastifyRequest & { rawBody?: Buffer },
      reply: FastifyReply,
    ) => {
      const secret = process.env.GITHUB_WEBHOOK_SECRET;
      const sig = req.headers['x-hub-signature-256'] as string | undefined;

      if (!secret || !sig) {
        return reply.code(401).send({ error: 'Missing signature', statusCode: 401 });
      }

      if (!req.rawBody) {
        return reply.code(400).send({ error: 'No raw body', statusCode: 400 });
      }

      if (!validateHmacSignature(req.rawBody, sig, secret)) {
        logger.warn({ module: 'webhook' }, 'Invalid HMAC signature');
        return reply.code(401).send({ error: 'Invalid signature', statusCode: 401 });
      }

      const event = req.headers['x-github-event'] as string;
      const payload = req.body as GithubWebhookIssuePayload;
      const repoSlug = payload.repository?.full_name?.toLowerCase() ?? '';

      // Only handle repos already tracked
      if (!(await isTrackedRepo(repoSlug))) {
        logger.info(
          { repoSlug, event, module: 'webhook' },
          'Untracked repo webhook — ignoring',
        );
        return reply.code(200).send({ ok: true, skipped: true });
      }

      // Respond immediately — processing is async
      reply.code(200).send({ ok: true });

      const issue = payload.issue;

      switch (`${event}.${payload.action}`) {
        case 'issues.opened': {
          const raw: RawIssue = {
            url: issue.html_url,
            externalId: String(issue.number),
            title: issue.title,
            bodyRaw: issue.body ?? '',
            source: 'github',
            repoSlug,
            labels: issue.labels.map((l) => l.name),
            state: 'open',
            createdAt: new Date(issue.created_at),
            updatedAt: new Date(issue.updated_at),
            author: issue.user?.login ?? 'unknown',
            commentsCount: issue.comments,
            rawJson: issue as unknown as Record<string, unknown>,
          };
          await rawIssuesQueue.add('issue', { issue: raw });
          break;
        }

        case 'issues.labeled':
        case 'issues.edited':
          // Reset enriched_at so the re-enrichment cron picks up the content change
          await pool.query(
            `UPDATE issues SET enriched_at = NULL WHERE url = $1`,
            [issue.html_url],
          );
          await refetchAndEmit(repoSlug, issue.number);
          break;

        case 'issues.closed':
          await closedIssuesQueue.add('close', {
            url: issue.html_url,
            closedAt: issue.closed_at ?? new Date().toISOString(),
          });
          break;

        default:
          // Unknown event — ignore
          break;
      }

      logger.info(
        { event, action: payload.action, repo: repoSlug, module: 'webhook' },
        'Webhook processed',
      );
    },
  );
}
