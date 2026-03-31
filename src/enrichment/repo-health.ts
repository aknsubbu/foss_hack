import type { IssueDoc } from '../types/issue';
import {
  getCachedRepoMeta,
  setCachedRepoMeta,
} from '../cache/redis';
import { logger } from '../api/logger';

interface RepoHealthBreakdown {
  starsScore: number;
  commitAgeScore: number;
  responseTimeScore: number;
  archivedScore: number;
  composite: number;
  starsCount: number;
  daysSinceLastCommit: number | null;
  avgIssueResponseHours: number | null;
  isArchived: boolean;
}

function computeStarsScore(stars: number): number {
  return Math.min(Math.log10(stars + 1) / 6, 1.0);
}

function computeCommitAgeScore(days: number | null): number {
  if (days === null) return 0.5; // unknown — neutral
  if (days < 7) return 1.0;
  if (days < 30) return 0.7;
  if (days < 90) return 0.4;
  return 0.1;
}

function computeResponseTimeScore(hours: number | null): number {
  if (hours === null) return 0.5;
  if (hours < 24) return 1.0;
  if (hours < 72) return 0.7;
  if (hours < 168) return 0.4;
  return 0.1;
}

function computeComposite(b: Omit<RepoHealthBreakdown, 'composite'>): number {
  if (b.isArchived) return 0.0; // archived overrides everything
  return (
    b.starsScore * 0.20 +
    b.commitAgeScore * 0.30 +
    b.responseTimeScore * 0.35 +
    b.archivedScore * 0.15
  );
}

interface GithubRepoData {
  stargazers_count?: number;
  pushed_at?: string;
  archived?: boolean;
  open_issues_count?: number;
}

async function fetchRepoData(
  repoSlug: string,
  token: string,
): Promise<GithubRepoData | null> {
  const cached = await getCachedRepoMeta(repoSlug);
  if (cached) return cached as GithubRepoData;

  try {
    const res = await fetch(`https://api.github.com/repos/${repoSlug}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GithubRepoData;
    await setCachedRepoMeta(repoSlug, data as Record<string, unknown>);
    return data;
  } catch (err) {
    logger.warn({ err, repoSlug, module: 'repo-health' }, 'Failed to fetch repo data');
    return null;
  }
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

export async function runRepoHealthScorer(
  issue: IssueDoc,
): Promise<Partial<IssueDoc>> {
  const token = process.env.GITHUB_TOKEN ?? '';
  let starsCount = 0;
  let daysSinceLastCommit: number | null = null;
  let isArchived = false;

  if (issue.source === 'github' && token) {
    const data = await fetchRepoData(issue.repoSlug, token);
    if (data) {
      starsCount = data.stargazers_count ?? 0;
      isArchived = data.archived ?? false;
      if (data.pushed_at) {
        daysSinceLastCommit = daysBetween(
          new Date(data.pushed_at),
          new Date(),
        );
      }
    }
  }

  const starsScore = computeStarsScore(starsCount);
  const commitAgeScore = computeCommitAgeScore(daysSinceLastCommit);
  // avg_issue_response_hours is hard to compute in real-time; use null for now
  const avgIssueResponseHours: number | null = null;
  const responseTimeScore = computeResponseTimeScore(avgIssueResponseHours);
  const archivedScore = isArchived ? 0.0 : 1.0;

  const breakdown: Omit<RepoHealthBreakdown, 'composite'> = {
    starsScore,
    commitAgeScore,
    responseTimeScore,
    archivedScore,
    starsCount,
    daysSinceLastCommit,
    avgIssueResponseHours,
    isArchived,
  };

  const composite = computeComposite(breakdown);

  const repoHealth: RepoHealthBreakdown = { ...breakdown, composite };

  return {
    repoHealthScore: composite,
    repoHealth: repoHealth as unknown as Record<string, unknown>,
  };
}
