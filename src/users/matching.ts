import { pool } from '../db/client';
import { redis } from '../cache/redis';
import { getUserById } from '../db/users';
import { logger } from '../api/logger';
import type { IssueDoc, User } from '../types/issue';

const CACHE_TTL_SECONDS = 600; // 10 minutes

export interface RecommendationOptions {
  limit?: number;
  freshness?: string;
  type?: string;
  mentored?: boolean;
  minGfiQuality?: number;
}

export interface MatchReason {
  domainOverlap: string[];
  skillOverlap: string[];
  difficultyMatch: boolean;
  gfiQuality: number | null;
  isMentored: boolean;
  embeddingSimilarity: number | null;
}

export interface Recommendation {
  issue: IssueDoc;
  matchScore: number;
  matchReasons: MatchReason;
}

export interface RecommendationResult {
  userId: string;
  recommendations: Recommendation[];
  totalCandidates: number;
  cached: boolean;
}

// --- Cache helpers ---

function makeCacheKey(userId: string, profileVersion: number, opts: RecommendationOptions): string {
  const filterHash = JSON.stringify({
    freshness: opts.freshness,
    type: opts.type,
    mentored: opts.mentored,
    minGfiQuality: opts.minGfiQuality,
    limit: opts.limit,
  });
  return `recommend:${userId}:v${profileVersion}:${Buffer.from(filterHash).toString('base64').slice(0, 16)}`;
}

async function getCachedResult(key: string): Promise<RecommendationResult | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as RecommendationResult;
  } catch {
    return null;
  }
}

async function setCachedResult(key: string, result: RecommendationResult): Promise<void> {
  try {
    await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(result));
  } catch {
    // Cache write failure is non-fatal
  }
}

// --- Row → IssueDoc (minimal, for recommendation results) ---

function rowToIssueDoc(row: Record<string, unknown>): IssueDoc {
  return {
    id: row.id as string,
    url: row.url as string,
    externalId: row.external_id as string,
    title: row.title as string,
    bodyRaw: (row.body_raw as string) ?? '',
    source: row.source as IssueDoc['source'],
    repoSlug: row.repo_slug as string,
    labels: (row.labels as string[]) ?? [],
    state: row.state as 'open' | 'closed',
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    author: row.author as string,
    commentsCount: (row.comments_count as number) ?? 0,
    difficultyLabel: row.difficulty_label as IssueDoc['difficultyLabel'],
    issueType: row.issue_type as IssueDoc['issueType'],
    techStack: (row.tech_stack as string[]) ?? [],
    repoHealthScore: row.repo_health_score as number | undefined,
    freshnessLabel: row.freshness_label as IssueDoc['freshnessLabel'],
    isMentored: (row.is_mentored as boolean) ?? false,
    domain: (row.domain as string[]) ?? [],
    skillsRequired: (row.skills_required as string[]) ?? [],
    contextDepth: row.context_depth as IssueDoc['contextDepth'],
    scope: row.scope as IssueDoc['scope'],
    gfiQualityScore: row.gfi_quality_score as number | undefined,
    hasClearCriteria: row.has_clear_criteria as boolean | undefined,
    hasReproductionSteps: row.has_reproduction_steps as boolean | undefined,
    rawJson: {},
  };
}

// --- Scoring ---

function computeMatchScore(
  issue: IssueDoc,
  user: User,
  embeddingSimilarity: number | null,
): { score: number; reasons: MatchReason } {
  const domainOverlap = (issue.domain ?? []).filter((d) =>
    (user.domains ?? []).map((ud) => ud.toLowerCase()).includes(d.toLowerCase()),
  );
  const skillOverlap = (issue.skillsRequired ?? []).filter((s) =>
    (user.skills ?? []).map((us) => us.toLowerCase()).includes(s.toLowerCase()),
  );
  const difficultyMatch =
    !user.preferredDifficulty || issue.difficultyLabel === user.preferredDifficulty;
  const gfiQuality = issue.gfiQualityScore ?? null;

  // Domain overlap score: ratio of user domains matched
  const userDomainCount = (user.domains ?? []).length;
  const domainScore = userDomainCount > 0 ? domainOverlap.length / userDomainCount : 0;

  const embeddingScore = embeddingSimilarity ?? 0;
  const gfiScore = gfiQuality ?? 0.5;
  const repoScore = issue.repoHealthScore ?? 0.5;

  // Weighted formula
  const score =
    0.4 * embeddingScore +
    0.3 * domainScore +
    0.2 * gfiScore +
    0.1 * repoScore;

  return {
    score: Math.round(score * 1000) / 1000,
    reasons: {
      domainOverlap,
      skillOverlap,
      difficultyMatch,
      gfiQuality,
      isMentored: issue.isMentored ?? false,
      embeddingSimilarity: embeddingSimilarity !== null
        ? Math.round(embeddingSimilarity * 1000) / 1000
        : null,
    },
  };
}

// --- Main matching function ---

export async function getRecommendations(
  userId: string,
  opts: RecommendationOptions = {},
): Promise<RecommendationResult> {
  const user = await getUserById(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const limit = Math.min(opts.limit ?? 20, 50);
  const cacheKey = makeCacheKey(userId, user.profileVersion ?? 1, { ...opts, limit });

  // Check cache
  const cached = await getCachedResult(cacheKey);
  if (cached) {
    logger.info({ userId, module: 'matching' }, 'Recommendations served from cache');
    return { ...cached, cached: true };
  }

  // --- Tier 1: Hard filter ---
  const conditions: string[] = ["state = 'open'"];
  const params: unknown[] = [];
  let i = 1;

  if ((user.techStack ?? []).length > 0) {
    conditions.push(`tech_stack && $${i++}::text[]`);
    params.push(user.techStack);
  }
  if (user.preferredDifficulty) {
    conditions.push(`difficulty_label = $${i++}`);
    params.push(user.preferredDifficulty);
  }
  if (opts.freshness) {
    conditions.push(`freshness_label = $${i++}`);
    params.push(opts.freshness);
  }
  if (opts.type) {
    conditions.push(`$${i++} = ANY(issue_type)`);
    params.push(opts.type);
  }
  if (opts.mentored) {
    conditions.push('is_mentored = TRUE');
  }
  if (opts.minGfiQuality) {
    conditions.push(`gfi_quality_score >= $${i++}`);
    params.push(opts.minGfiQuality);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  // Count total candidates
  const countRes = await pool.query(`SELECT COUNT(*) FROM issues ${where}`, params);
  const totalCandidates = parseInt(countRes.rows[0].count as string, 10);

  // --- Tier 2: Vector similarity (if user has embedding) ---
  let rows: Record<string, unknown>[] = [];

  if (user.embedding && user.embedding.length > 0) {
    const embeddingStr = `[${user.embedding.join(',')}]`;
    const vectorSql = `
      SELECT *,
        1 - (embedding <=> $${i}::vector) AS embedding_similarity
      FROM issues
      ${where}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $${i}::vector
      LIMIT 100
    `;
    const vectorRes = await pool.query(vectorSql, [...params, embeddingStr]);
    rows = vectorRes.rows as Record<string, unknown>[];

    // Also get issues without embeddings (tag-only fallback), up to 50 more
    if (rows.length < 50) {
      const fallbackSql = `
        SELECT *, NULL AS embedding_similarity
        FROM issues
        ${where}
          AND embedding IS NULL
        ORDER BY COALESCE(gfi_quality_score, 0) DESC, created_at DESC
        LIMIT 50
      `;
      const fallbackRes = await pool.query(fallbackSql, params);
      rows = [...rows, ...(fallbackRes.rows as Record<string, unknown>[])];
    }
  } else {
    // No user embedding — use tag-based only
    const fallbackSql = `
      SELECT *, NULL AS embedding_similarity
      FROM issues
      ${where}
      ORDER BY COALESCE(gfi_quality_score, 0) DESC,
               COALESCE(repo_health_score, 0) DESC,
               created_at DESC
      LIMIT 100
    `;
    const fallbackRes = await pool.query(fallbackSql, params);
    rows = fallbackRes.rows as Record<string, unknown>[];
  }

  // --- Tier 3: Score and rank ---
  const recommendations: Recommendation[] = rows.map((row) => {
    const issue = rowToIssueDoc(row);
    const embeddingSimilarity =
      row.embedding_similarity !== null && row.embedding_similarity !== undefined
        ? Number(row.embedding_similarity)
        : null;
    const { score, reasons } = computeMatchScore(issue, user, embeddingSimilarity);
    return { issue, matchScore: score, matchReasons: reasons };
  });

  recommendations.sort((a, b) => b.matchScore - a.matchScore);
  const topN = recommendations.slice(0, limit);

  const result: RecommendationResult = {
    userId,
    recommendations: topN,
    totalCandidates,
    cached: false,
  };

  await setCachedResult(cacheKey, result);

  logger.info(
    { userId, totalCandidates, returned: topN.length, module: 'matching' },
    'Recommendations computed',
  );

  return result;
}

// --- Similar issues (pure vector search) ---

export async function getSimilarIssues(
  issueId: string,
  limit = 10,
): Promise<IssueDoc[]> {
  // Get the source issue's embedding
  const sourceRes = await pool.query(
    'SELECT embedding FROM issues WHERE id = $1',
    [issueId],
  );
  if (!sourceRes.rows[0]?.embedding) return [];

  const embedding = sourceRes.rows[0].embedding as string;

  const res = await pool.query(
    `SELECT *, 1 - (embedding <=> $1::vector) AS embedding_similarity
     FROM issues
     WHERE id != $2
       AND state = 'open'
       AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [embedding, issueId, limit],
  );

  return res.rows.map((row) => rowToIssueDoc(row as Record<string, unknown>));
}
