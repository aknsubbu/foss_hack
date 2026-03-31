import 'dotenv/config';
import { Worker } from 'bullmq';
import { logger } from '../api/logger';
import { enrichIssue } from '../enrichment/pipeline';
import { upsertIssue, closeIssue, pool, rowToIssueDoc } from '../db/client';
import { syncIssueToSearch } from '../search/meilisearch';
import { rawIssuesQueue } from './queues';
import type {
  RawIssueJobPayload,
  RepoDiscoveryJobPayload,
  ClosedIssueJobPayload,
  ReEnrichJobPayload,
} from '../types/issue';

const connection = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
};

const workerConcurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10);

// Worker 1: raw_issues — full enrichment pipeline
const rawIssuesWorker = new Worker<RawIssueJobPayload>(
  'raw_issues',
  async (job) => {
    const { issue } = job.data;

    logger.info(
      { url: issue.url, source: issue.source, module: 'worker:raw_issues' },
      'Issue ingested — starting enrichment',
    );

    const enriched = await enrichIssue(issue);
    await upsertIssue(enriched);
    await syncIssueToSearch(enriched);

    logger.info(
      {
        url: enriched.url,
        difficultyLabel: enriched.difficultyLabel,
        techStack: enriched.techStack,
        module: 'worker:raw_issues',
      },
      'Issue enriched and stored',
    );
  },
  { connection, concurrency: workerConcurrency },
);

// Worker 2: repo_discovery — fetch all open issues for a new repo
const repoDiscoveryWorker = new Worker<RepoDiscoveryJobPayload>(
  'repo_discovery',
  async (job) => {
    const { slug, source } = job.data;
    const token = process.env.GITHUB_TOKEN ?? '';

    logger.info({ slug, source, module: 'worker:repo_discovery' }, 'Onboarding new repo');

    if (source !== 'github') return; // MVP: GitHub only

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `https://api.github.com/repos/${slug}/issues?state=open&per_page=100&page=${page}&labels=good+first+issue,help+wanted`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!res.ok) break;
      const issues = (await res.json()) as Array<Record<string, unknown>>;
      if (issues.length === 0) {
        hasMore = false;
        break;
      }

      for (const ghIssue of issues) {
        const repo = ghIssue.repository as Record<string, unknown> | undefined;
        await rawIssuesQueue.add('issue', {
          issue: {
            url: ghIssue.html_url as string,
            externalId: String(ghIssue.number),
            title: ghIssue.title as string,
            bodyRaw: (ghIssue.body as string) ?? '',
            source: 'github',
            repoSlug: slug,
            labels: ((ghIssue.labels as Array<{ name: string }>) ?? []).map(
              (l) => l.name,
            ),
            state: (ghIssue.state as 'open' | 'closed') ?? 'open',
            createdAt: new Date(ghIssue.created_at as string),
            updatedAt: new Date(ghIssue.updated_at as string),
            closedAt: ghIssue.closed_at
              ? new Date(ghIssue.closed_at as string)
              : undefined,
            author:
              (ghIssue.user as Record<string, unknown> | undefined)?.login as string ?? 'unknown',
            commentsCount: (ghIssue.comments as number) ?? 0,
            rawJson: ghIssue,
          },
        });
      }

      page++;
      // Respect rate limits — 1 second between pages
      await sleep(1000);
    }

    logger.info({ slug, module: 'worker:repo_discovery' }, 'Repo onboarding complete');
  },
  { connection, concurrency: 2 },
);

// Worker 3: closed_issues — mark issues as closed
const closedIssuesWorker = new Worker<ClosedIssueJobPayload>(
  'closed_issues',
  async (job) => {
    const { url, closedAt } = job.data;
    await closeIssue(url, new Date(closedAt));
    logger.info({ url, module: 'worker:closed_issues' }, 'Issue marked closed');
  },
  { connection, concurrency: 10 },
);

// Worker 4: re_enrich — re-run enrichment from stored raw_json
const reEnrichWorker = new Worker<ReEnrichJobPayload>(
  're_enrich',
  async (job) => {
    const { issueUrl } = job.data;
    const res = await pool.query('SELECT * FROM issues WHERE url = $1', [issueUrl]);
    if (res.rows.length === 0) return;

    const { reEnrichFromRaw } = await import('../enrichment/pipeline');
    const storedDoc = rowToIssueDoc(res.rows[0] as Record<string, unknown>);
    const enriched = await reEnrichFromRaw(storedDoc);
    await upsertIssue(enriched);
    await syncIssueToSearch(enriched);

    logger.info({ url: issueUrl, module: 'worker:re_enrich' }, 'Re-enrichment complete');
  },
  { connection, concurrency: 3 },
);

// Error handlers
for (const [name, worker] of [
  ['raw_issues', rawIssuesWorker],
  ['repo_discovery', repoDiscoveryWorker],
  ['closed_issues', closedIssuesWorker],
  ['re_enrich', reEnrichWorker],
] as const) {
  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id, module: `worker:${name}` }, 'Job failed');
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

logger.info('All workers started');
