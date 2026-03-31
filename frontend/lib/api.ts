import type {
  BrowseFilters,
  BrowseResponse,
  CreateUserPayload,
  Difficulty,
  Domain,
  Freshness,
  Issue,
  IssueType,
  Recommendation,
  RecommendationFilters,
  RecommendationsResponse,
  SearchHit,
  SearchResponse,
  UserProfile,
} from './types';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── Transform helpers ─────────────────────────────────────────────────────────

// Backend IssueDoc (camelCase) → frontend Issue
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformIssue(raw: Record<string, any>): Issue {
  const gfiScore = raw.gfiQualityScore as number | undefined;
  const issueTypes = (raw.issueType as string[]) ?? [];

  return {
    id: raw.id as string,
    number: raw.externalId ? parseInt(String(raw.externalId), 10) : 0,
    title: raw.title as string,
    body: raw.bodyRaw as string | undefined,
    url: raw.url as string,
    repoSlug: raw.repoSlug as string,
    repoUrl: raw.repoUrl as string | undefined,
    labels: (raw.labels as string[]) ?? [],
    difficulty: (raw.difficultyLabel as Difficulty) ?? 'medium',
    type: (issueTypes[0] as IssueType) ?? 'feature',
    domain: (raw.domain as Domain[]) ?? [],
    language: (raw.techStack as string[]) ?? [],
    isGoodFirstIssue: gfiScore !== undefined ? gfiScore > 0.6 : false,
    gfiQualityScore: gfiScore,
    hasMentor: (raw.isMentored as boolean) ?? false,
    freshness: raw.freshnessLabel as Freshness | undefined,
    createdAt: raw.createdAt
      ? new Date(raw.createdAt as string).toISOString()
      : undefined,
    updatedAt: raw.updatedAt
      ? new Date(raw.updatedAt as string).toISOString()
      : undefined,
    commentCount: (raw.commentsCount as number) ?? 0,
    author: raw.author as string | undefined,
  };
}

// Backend MatchReason object → human-readable string[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformMatchReasons(reasons: Record<string, any>): string[] {
  if (!reasons || typeof reasons !== 'object') return [];
  const result: string[] = [];

  const domainOverlap = (reasons.domainOverlap as string[]) ?? [];
  if (domainOverlap.length > 0) {
    result.push(`Domain match: ${domainOverlap.join(', ')}`);
  }

  const skillOverlap = (reasons.skillOverlap as string[]) ?? [];
  if (skillOverlap.length > 0) {
    result.push(`Skills: ${skillOverlap.slice(0, 3).join(', ')}`);
  }

  if (reasons.difficultyMatch) {
    result.push('Matches your preferred difficulty');
  }

  if (reasons.isMentored) {
    result.push('Has mentorship available');
  }

  const sim = reasons.embeddingSimilarity as number | null;
  if (sim !== null && sim >= 0.7) {
    result.push('Strong semantic similarity to your profile');
  } else if (sim !== null && sim >= 0.5) {
    result.push('Good semantic similarity to your profile');
  }

  return result;
}

// Backend Recommendation → frontend Recommendation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformRecommendation(raw: Record<string, any>): Recommendation {
  const reasons = raw.matchReasons as Record<string, unknown> ?? {};
  return {
    issue: transformIssue(raw.issue as Record<string, unknown>),
    matchScore: raw.matchScore as number,
    matchReasons: transformMatchReasons(reasons),
    skillOverlap: (reasons.skillOverlap as string[]) ?? [],
  };
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function createUser(
  payload: CreateUserPayload,
): Promise<UserProfile> {
  return request<UserProfile>('/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getUser(id: string): Promise<UserProfile> {
  return request<UserProfile>(`/users/${id}`);
}

// ── Recommendations ───────────────────────────────────────────────────────────

export async function getRecommendations(
  userId: string,
  filters: RecommendationFilters = {},
): Promise<RecommendationsResponse> {
  const params = new URLSearchParams();

  if (filters.limit !== undefined)
    params.set('limit', String(filters.limit));
  if (filters.freshness) params.set('freshness', filters.freshness);
  if (filters.type) params.set('type', filters.type);
  if (filters.mentored !== undefined)
    params.set('mentored', String(filters.mentored));
  if (filters.min_gfi_quality !== undefined)
    params.set('min_gfi_quality', String(filters.min_gfi_quality));

  const qs = params.toString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await request<Record<string, any>>(
    `/users/${userId}/recommendations${qs ? `?${qs}` : ''}`,
  );

  return {
    userId: raw.userId as string,
    totalCandidates: raw.totalCandidates as number,
    cached: raw.cached as boolean,
    recommendations: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (raw.recommendations as Record<string, any>[]) ?? []
    ).map(transformRecommendation),
  };
}

// ── Browse ────────────────────────────────────────────────────────────────────

export async function browseIssues(
  filters: BrowseFilters = {},
): Promise<BrowseResponse> {
  const params = new URLSearchParams();

  if (filters.lang) params.set('lang', filters.lang);
  if (filters.difficulty) params.set('difficulty', filters.difficulty);
  if (filters.type) params.set('type', filters.type);
  if (filters.freshness) params.set('freshness', filters.freshness);
  if (filters.mentored !== undefined)
    params.set('mentored', String(filters.mentored));
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.limit !== undefined)
    params.set('limit', String(filters.limit));

  const qs = params.toString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await request<Record<string, any>>(
    `/issues${qs ? `?${qs}` : ''}`,
  );

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: ((raw.data as Record<string, any>[]) ?? []).map(transformIssue),
    total: (raw.meta?.total as number) ?? (raw.total as number) ?? 0,
  };
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchIssues(q: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await request<Record<string, any>>(
    `/search?${params.toString()}`,
  );

  // Meilisearch hits may use snake_case — normalise to frontend SearchHit shape
  const hits: SearchHit[] = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (raw.hits as Record<string, any>[]) ?? []
  ).map((h) => {
    const gfiScore = (h.gfi_quality_score ?? h.gfiQualityScore) as
      | number
      | undefined;
    const issueTypes = (
      (h.issue_type ?? h.issueType ?? []) as string[]
    );
    return {
      id: h.id as string,
      title: h.title as string,
      repoSlug: (h.repo_slug ?? h.repoSlug) as string,
      difficulty: ((h.difficulty_label ?? h.difficultyLabel ?? 'medium') as Difficulty),
      domain: ((h.domain ?? []) as Domain[]),
      language: ((h.tech_stack ?? h.techStack ?? []) as string[]),
      type: (issueTypes[0] as IssueType) ?? 'feature',
      url: h.url as string,
      isGoodFirstIssue: gfiScore !== undefined ? gfiScore > 0.6 : false,
      gfiQualityScore: gfiScore,
      hasMentor: (h.is_mentored ?? h.isMentored ?? false) as boolean,
      freshness: (h.freshness_label ?? h.freshnessLabel) as Freshness | undefined,
      labels: ((h.labels ?? []) as string[]),
      number: h.external_id
        ? parseInt(String(h.external_id), 10)
        : (h.number as number) ?? 0,
    };
  });

  return {
    hits,
    estimatedTotalHits: raw.estimatedTotalHits as number ?? 0,
    facetDistribution: raw.facetDistribution as Record<string, Record<string, number>> | undefined,
  };
}
