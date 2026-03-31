import { parse as parseYaml } from 'yaml';
import { repoDiscoveryQueue } from '../queue/queues';
import { logger } from '../api/logger';

interface GoodFirstIssueEntry {
  owner?: string;
  name?: string;
  url?: string;
  repositoryTopics?: string[];
}

interface UpForGrabsEntry {
  github?: { repository?: string };
  name?: string;
  tags?: string[];
}

async function fetchGoodFirstIssue(): Promise<string[]> {
  const url =
    'https://raw.githubusercontent.com/nicedoc/goodfirstissue/main/data.json';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as GoodFirstIssueEntry[];

    const slugs: string[] = [];
    for (const entry of data) {
      if (entry.owner && entry.name) {
        slugs.push(`${entry.owner}/${entry.name}`);
      } else if (entry.url) {
        const match = entry.url.match(/github\.com\/([^/]+\/[^/]+)/);
        if (match) slugs.push(match[1]);
      }
    }
    return slugs;
  } catch (err) {
    logger.warn({ err, module: 'aggregator-fetcher' }, 'Failed to fetch goodfirstissue.dev data');
    return [];
  }
}

async function fetchUpForGrabs(): Promise<string[]> {
  const url =
    'https://raw.githubusercontent.com/up-for-grabs/up-for-grabs.net/gh-pages/_data/projects.yaml';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const data = parseYaml(text) as UpForGrabsEntry[];

    const slugs: string[] = [];
    for (const entry of data) {
      const repo = entry.github?.repository;
      if (repo) {
        // repo might be 'owner/name' or full URL
        const match = repo.match(/(?:github\.com\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
        if (match) slugs.push(match[1]);
      }
    }
    return slugs;
  } catch (err) {
    logger.warn({ err, module: 'aggregator-fetcher' }, 'Failed to fetch up-for-grabs data');
    return [];
  }
}

export async function runAggregatorFetcher(): Promise<void> {
  logger.info({ module: 'aggregator-fetcher' }, 'Collector started');

  const [goodFirstSlugs, upForGrabsSlugs] = await Promise.all([
    fetchGoodFirstIssue(),
    fetchUpForGrabs(),
  ]);

  // Merge and deduplicate by slug
  const slugSet = new Set<string>();
  for (const slug of [...goodFirstSlugs, ...upForGrabsSlugs]) {
    if (slug && slug.includes('/')) {
      slugSet.add(slug.toLowerCase());
    }
  }

  logger.info(
    { count: slugSet.size, module: 'aggregator-fetcher' },
    'Discovered repos from aggregators',
  );

  for (const slug of slugSet) {
    await repoDiscoveryQueue.add('repo', { slug, source: 'github' });
  }

  logger.info({ module: 'aggregator-fetcher' }, 'Aggregator fetcher complete');
}
