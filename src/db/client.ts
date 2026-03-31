import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';
import { logger } from '../api/logger';
import type { IssueDoc, RepoMeta } from '../types/issue';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

// Run all migrations in order on startup
export async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      logger.info({ file }, 'Running migration');
      await client.query(sql);
    }
    logger.info('All migrations completed');
  } finally {
    client.release();
  }
}

// Idempotent upsert for a fully enriched IssueDoc
export async function upsertIssue(doc: IssueDoc): Promise<void> {
  const sql = `
    INSERT INTO issues (
      url, external_id, title, body_raw, source, repo_slug,
      labels, state, created_at, updated_at, closed_at, author, comments_count,
      difficulty_score, difficulty_label, issue_type, tech_stack,
      repo_health_score, repo_health, freshness_label,
      issue_age_days, days_since_activity, is_mentored,
      source_list, embedding, raw_json, enriched_at,
      domain, skills_required, context_depth, scope,
      gfi_quality_score, has_clear_criteria, has_reproduction_steps
    ) VALUES (
      $1,$2,$3,$4,$5,$6,
      $7,$8,$9,$10,$11,$12,$13,
      $14,$15,$16,$17,
      $18,$19,$20,
      $21,$22,$23,
      $24,$25,$26,$27,
      $28,$29,$30,$31,
      $32,$33,$34
    )
    ON CONFLICT (url) DO UPDATE SET
      title                  = EXCLUDED.title,
      body_raw               = EXCLUDED.body_raw,
      state                  = EXCLUDED.state,
      updated_at             = EXCLUDED.updated_at,
      closed_at              = EXCLUDED.closed_at,
      comments_count         = EXCLUDED.comments_count,
      labels                 = EXCLUDED.labels,
      difficulty_score       = COALESCE(EXCLUDED.difficulty_score,       issues.difficulty_score),
      difficulty_label       = COALESCE(EXCLUDED.difficulty_label,       issues.difficulty_label),
      issue_type             = COALESCE(EXCLUDED.issue_type,             issues.issue_type),
      tech_stack             = COALESCE(EXCLUDED.tech_stack,             issues.tech_stack),
      repo_health_score      = COALESCE(EXCLUDED.repo_health_score,      issues.repo_health_score),
      repo_health            = COALESCE(EXCLUDED.repo_health,            issues.repo_health),
      freshness_label        = COALESCE(EXCLUDED.freshness_label,        issues.freshness_label),
      issue_age_days         = COALESCE(EXCLUDED.issue_age_days,         issues.issue_age_days),
      days_since_activity    = COALESCE(EXCLUDED.days_since_activity,    issues.days_since_activity),
      is_mentored            = COALESCE(EXCLUDED.is_mentored,            issues.is_mentored),
      source_list            = COALESCE(EXCLUDED.source_list,            issues.source_list),
      embedding              = COALESCE(EXCLUDED.embedding,              issues.embedding),
      raw_json               = EXCLUDED.raw_json,
      enriched_at            = EXCLUDED.enriched_at,
      domain                 = COALESCE(EXCLUDED.domain,                 issues.domain),
      skills_required        = COALESCE(EXCLUDED.skills_required,        issues.skills_required),
      context_depth          = COALESCE(EXCLUDED.context_depth,          issues.context_depth),
      scope                  = COALESCE(EXCLUDED.scope,                  issues.scope),
      gfi_quality_score      = COALESCE(EXCLUDED.gfi_quality_score,      issues.gfi_quality_score),
      has_clear_criteria     = COALESCE(EXCLUDED.has_clear_criteria,     issues.has_clear_criteria),
      has_reproduction_steps = COALESCE(EXCLUDED.has_reproduction_steps, issues.has_reproduction_steps)
  `;

  const embeddingStr = doc.embedding
    ? `[${doc.embedding.join(',')}]`
    : null;

  const values = [
    doc.url,
    doc.externalId,
    doc.title,
    doc.bodyRaw,
    doc.source,
    doc.repoSlug,
    doc.labels,
    doc.state,
    doc.createdAt,
    doc.updatedAt,
    doc.closedAt ?? null,
    doc.author,
    doc.commentsCount,
    doc.difficultyScore ?? null,
    doc.difficultyLabel ?? null,
    doc.issueType ?? null,
    doc.techStack ?? null,
    doc.repoHealthScore ?? null,
    doc.repoHealth ? JSON.stringify(doc.repoHealth) : null,
    doc.freshnessLabel ?? null,
    doc.issueAgeDays ?? null,
    doc.daysSinceActivity ?? null,
    doc.isMentored ?? false,
    doc.sourceList ?? null,
    embeddingStr,
    JSON.stringify(doc.rawJson),
    doc.enrichedAt ?? null,
    doc.domain ?? null,
    doc.skillsRequired ?? null,
    doc.contextDepth ?? null,
    doc.scope ?? null,
    doc.gfiQualityScore ?? null,
    doc.hasClearCriteria ?? null,
    doc.hasReproductionSteps ?? null,
  ];

  try {
    await pool.query(sql, values);
  } catch (err) {
    logger.error({ err, url: doc.url }, 'DB upsert failed');
    throw err;
  }
}

// Upsert repo metadata
export async function upsertRepo(repo: RepoMeta): Promise<void> {
  const sql = `
    INSERT INTO repos (
      slug, source, name, description, html_url,
      stars_count, forks_count, open_issues_count,
      primary_language, languages, topics, is_archived,
      days_since_last_commit, avg_issue_response_hours, repo_health_score,
      last_polled_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW()
    )
    ON CONFLICT (slug) DO UPDATE SET
      name                     = COALESCE(EXCLUDED.name, repos.name),
      description              = COALESCE(EXCLUDED.description, repos.description),
      stars_count              = COALESCE(EXCLUDED.stars_count, repos.stars_count),
      forks_count              = COALESCE(EXCLUDED.forks_count, repos.forks_count),
      open_issues_count        = COALESCE(EXCLUDED.open_issues_count, repos.open_issues_count),
      primary_language         = COALESCE(EXCLUDED.primary_language, repos.primary_language),
      languages                = COALESCE(EXCLUDED.languages, repos.languages),
      topics                   = COALESCE(EXCLUDED.topics, repos.topics),
      is_archived              = COALESCE(EXCLUDED.is_archived, repos.is_archived),
      days_since_last_commit   = COALESCE(EXCLUDED.days_since_last_commit, repos.days_since_last_commit),
      avg_issue_response_hours = COALESCE(EXCLUDED.avg_issue_response_hours, repos.avg_issue_response_hours),
      repo_health_score        = COALESCE(EXCLUDED.repo_health_score, repos.repo_health_score),
      updated_at               = NOW(),
      last_polled_at           = NOW()
  `;

  await pool.query(sql, [
    repo.slug,
    repo.source,
    repo.name ?? null,
    repo.description ?? null,
    repo.htmlUrl ?? null,
    repo.starsCount ?? 0,
    repo.forksCount ?? 0,
    repo.openIssuesCount ?? 0,
    repo.primaryLanguage ?? null,
    repo.languages ?? null,
    repo.topics ?? null,
    repo.isArchived ?? false,
    repo.daysSinceLastCommit ?? null,
    repo.avgIssueResponseHours ?? null,
    repo.repoHealthScore ?? null,
  ]);
}

// Mark issue as closed
export async function closeIssue(url: string, closedAt: Date): Promise<void> {
  await pool.query(
    `UPDATE issues SET state = 'closed', closed_at = $2, updated_at = NOW() WHERE url = $1`,
    [url, closedAt],
  );
}

// Fetch a single issue by UUID
export async function getIssueById(id: string): Promise<IssueDoc | null> {
  const res = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
  return res.rows[0] ? rowToIssueDoc(res.rows[0]) : null;
}

// Browse issues with filters
export interface BrowseOptions {
  lang?: string[];
  difficulty?: string;
  type?: string;
  freshness?: string;
  mentored?: boolean;
  source?: string;
  page?: number;
  limit?: number;
  sort?: string;
}

export async function browseIssues(
  opts: BrowseOptions,
): Promise<{ data: IssueDoc[]; total: number }> {
  const conditions: string[] = ["state = 'open'"];
  const params: unknown[] = [];
  let i = 1;

  if (opts.lang && opts.lang.length > 0) {
    conditions.push(`tech_stack && $${i++}::text[]`);
    params.push(opts.lang);
  }
  if (opts.difficulty) {
    conditions.push(`difficulty_label = $${i++}`);
    params.push(opts.difficulty);
  }
  if (opts.type) {
    conditions.push(`$${i++} = ANY(issue_type)`);
    params.push(opts.type);
  }
  if (opts.freshness) {
    conditions.push(`freshness_label = $${i++}`);
    params.push(opts.freshness);
  }
  if (opts.mentored === true) {
    conditions.push(`is_mentored = TRUE`);
  }
  if (opts.source) {
    conditions.push(`source = $${i++}`);
    params.push(opts.source);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortMap: Record<string, string> = {
    created_at: 'created_at DESC',
    updated_at: 'updated_at DESC',
    repo_health_score: 'repo_health_score DESC NULLS LAST',
  };
  const orderBy = sortMap[opts.sort ?? ''] ?? 'created_at DESC';

  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = ((opts.page ?? 1) - 1) * limit;

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM issues ${where}`,
    params,
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const dataRes = await pool.query(
    `SELECT * FROM issues ${where} ORDER BY ${orderBy} LIMIT $${i} OFFSET $${i + 1}`,
    [...params, limit, offset],
  );

  return { data: dataRes.rows.map(rowToIssueDoc), total };
}

export function rowToIssueDoc(row: Record<string, unknown>): IssueDoc {
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
    closedAt: row.closed_at ? new Date(row.closed_at as string) : undefined,
    author: row.author as string,
    commentsCount: (row.comments_count as number) ?? 0,
    difficultyScore: row.difficulty_score as number | undefined,
    difficultyLabel: row.difficulty_label as IssueDoc['difficultyLabel'],
    issueType: row.issue_type as IssueDoc['issueType'],
    techStack: (row.tech_stack as string[]) ?? [],
    repoHealthScore: row.repo_health_score as number | undefined,
    repoHealth: row.repo_health as Record<string, unknown> | undefined,
    freshnessLabel: row.freshness_label as IssueDoc['freshnessLabel'],
    issueAgeDays: row.issue_age_days as number | undefined,
    daysSinceActivity: row.days_since_activity as number | undefined,
    isMentored: (row.is_mentored as boolean) ?? false,
    sourceList: (row.source_list as string[]) ?? [],
    enrichedAt: row.enriched_at ? new Date(row.enriched_at as string) : undefined,
    ingestedAt: row.ingested_at ? new Date(row.ingested_at as string) : undefined,
    rawJson: (row.raw_json as Record<string, unknown>) ?? {},
    domain: (row.domain as string[]) ?? undefined,
    skillsRequired: (row.skills_required as string[]) ?? undefined,
    contextDepth: row.context_depth as IssueDoc['contextDepth'],
    scope: row.scope as IssueDoc['scope'],
    gfiQualityScore: row.gfi_quality_score as number | undefined,
    hasClearCriteria: row.has_clear_criteria as boolean | undefined,
    hasReproductionSteps: row.has_reproduction_steps as boolean | undefined,
  };
}
