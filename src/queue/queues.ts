import { Queue } from 'bullmq';
import type {
  RawIssueJobPayload,
  RepoDiscoveryJobPayload,
  ClosedIssueJobPayload,
  ReEnrichJobPayload,
} from '../types/issue';

const connection = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
};

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export const rawIssuesQueue = new Queue<RawIssueJobPayload>('raw_issues', {
  connection,
  defaultJobOptions,
});

export const repoDiscoveryQueue = new Queue<RepoDiscoveryJobPayload>(
  'repo_discovery',
  { connection, defaultJobOptions },
);

export const closedIssuesQueue = new Queue<ClosedIssueJobPayload>(
  'closed_issues',
  { connection, defaultJobOptions },
);

export const reEnrichQueue = new Queue<ReEnrichJobPayload>('re_enrich', {
  connection,
  defaultJobOptions,
});

// Graceful shutdown — drain all queues before process exit
export async function closeAllQueues(): Promise<void> {
  await Promise.all([
    rawIssuesQueue.close(),
    repoDiscoveryQueue.close(),
    closedIssuesQueue.close(),
    reEnrichQueue.close(),
  ]);
}
