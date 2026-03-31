import { getCursor, setCursor, isSeen, markSeen } from '../cache/redis';
import { rawIssuesQueue } from '../queue/queues';
import { logger } from '../api/logger';
import type { RawIssue } from '../types/issue';

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';
const CURSOR_KEY = 'github-poller';

const QUERY = `
  query GetIssues($cursor: String) {
    search(
      query: "label:\\"good-first-issue\\" OR label:\\"help-wanted\\" state:open"
      type: ISSUE
      first: 100
      after: $cursor
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on Issue {
          number url title body state createdAt updatedAt closedAt
          author { login }
          comments { totalCount }
          labels(first: 20) { nodes { name } }
          repository {
            nameWithOwner url stargazerCount forkCount
            primaryLanguage { name }
            languages(first: 5) { nodes { name } }
            repositoryTopics(first: 10) { nodes { topic { name } } }
            isArchived pushedAt
          }
        }
      }
    }
  }
`;

interface GithubIssueNode {
  number: number;
  url: string;
  title: string;
  body: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  author?: { login: string };
  comments?: { totalCount: number };
  labels?: { nodes: Array<{ name: string }> };
  repository?: {
    nameWithOwner: string;
    url: string;
    stargazerCount: number;
    forkCount: number;
    primaryLanguage?: { name: string };
    languages?: { nodes: Array<{ name: string }> };
    repositoryTopics?: { nodes: Array<{ topic: { name: string } }> };
    isArchived: boolean;
    pushedAt: string;
  };
}

interface GraphQLResponse {
  data?: {
    search?: {
      pageInfo?: { hasNextPage: boolean; endCursor?: string };
      nodes?: GithubIssueNode[];
    };
  };
  errors?: Array<{ message: string }>;
}

async function fetchPage(cursor: string | null): Promise<GraphQLResponse> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');

  const res = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { cursor },
    }),
  });

  if (res.status === 429 || res.status === 403) {
    const remaining = res.headers.get('X-RateLimit-Remaining');
    logger.warn(
      { remaining, module: 'github-poller' },
      'Rate limit approaching — backing off',
    );
    await sleep(60000);
    throw new Error(`GitHub rate limit: ${res.status}`);
  }

  if (!res.ok) throw new Error(`GitHub GraphQL error: ${res.status}`);
  return res.json() as Promise<GraphQLResponse>;
}

function nodeToRawIssue(node: GithubIssueNode): RawIssue {
  return {
    url: node.url,
    externalId: String(node.number),
    title: node.title,
    bodyRaw: node.body ?? '',
    source: 'github',
    repoSlug: node.repository?.nameWithOwner ?? '',
    labels: node.labels?.nodes.map((l) => l.name) ?? [],
    state: (node.state?.toLowerCase() as 'open' | 'closed') ?? 'open',
    createdAt: new Date(node.createdAt),
    updatedAt: new Date(node.updatedAt),
    closedAt: node.closedAt ? new Date(node.closedAt) : undefined,
    author: node.author?.login ?? 'unknown',
    commentsCount: node.comments?.totalCount ?? 0,
    rawJson: node as unknown as Record<string, unknown>,
  };
}

export async function runGithubPoller(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logger.warn({ module: 'github-poller' }, 'GITHUB_TOKEN not set — skipping poll');
    return;
  }

  logger.info({ module: 'github-poller' }, 'Collector started');

  let cursor: string | null = await getCursor(CURSOR_KEY);
  let pageCount = 0;
  let newIssues = 0;

  try {
    while (true) {
      const response = await fetchPage(cursor);

      if (response.errors?.length) {
        logger.error(
          { errors: response.errors, module: 'github-poller' },
          'GraphQL errors',
        );
        break;
      }

      const search = response.data?.search;
      if (!search) break;

      const nodes = (search.nodes ?? []).filter(
        (n): n is GithubIssueNode => n !== null && typeof n === 'object',
      );

      for (const node of nodes) {
        if (!node.url) continue;

        const alreadySeen = await isSeen(node.url);
        if (alreadySeen) continue;

        await markSeen(node.url);
        const rawIssue = nodeToRawIssue(node);
        await rawIssuesQueue.add('issue', { issue: rawIssue });
        newIssues++;
      }

      pageCount++;
      const pageInfo = search.pageInfo;

      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;

      cursor = pageInfo.endCursor;
      await setCursor(CURSOR_KEY, cursor);

      // 1-second delay between pages to respect rate limits
      await sleep(1000);
    }
  } finally {
    logger.info(
      { pageCount, newIssues, module: 'github-poller' },
      'GitHub poller finished',
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
