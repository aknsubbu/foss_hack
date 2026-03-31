import type { IssueDoc, FreshnessLabel } from '../types/issue';

// Pure computation — no API calls needed.
// Based solely on issue createdAt and updatedAt timestamps.
export async function runFreshnessTracker(
  issue: IssueDoc,
): Promise<Partial<IssueDoc>> {
  const now = Date.now();

  const issueAgeDays = Math.floor(
    (now - issue.createdAt.getTime()) / 86400000,
  );
  const daysSinceActivity = Math.floor(
    (now - issue.updatedAt.getTime()) / 86400000,
  );

  const freshnessLabel: FreshnessLabel =
    daysSinceActivity < 30
      ? 'fresh'
      : daysSinceActivity < 180
        ? 'active'
        : 'stale';

  return { freshnessLabel, issueAgeDays, daysSinceActivity };
}
