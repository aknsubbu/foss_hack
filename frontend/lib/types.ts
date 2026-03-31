export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type IssueType =
  | 'bug-fix'
  | 'feature'
  | 'documentation'
  | 'tests'
  | 'refactor'
  | 'performance';
export type Freshness = 'fresh' | 'recent' | 'any';
export type Domain =
  | 'frontend'
  | 'backend'
  | 'devtools'
  | 'infrastructure'
  | 'ml'
  | 'mobile'
  | 'database'
  | 'security'
  | 'testing'
  | 'docs';

// ── User ────────────────────────────────────────────────────────────────────

export interface CreateUserPayload {
  githubUsername?: string;
  prompt?: string;
  techStack?: string[];
  domains?: Domain[];
  experienceLevel?: ExperienceLevel;
  preferredDifficulty?: Difficulty;
  preferredTypes?: IssueType[];
}

export interface UserProfile {
  id: string;
  githubUsername?: string;
  prompt?: string;
  techStack: string[];
  domains: Domain[];
  skills: string[];
  experienceLevel: ExperienceLevel;
  preferredDifficulty?: Difficulty;
  preferredTypes?: IssueType[];
  createdAt?: string;
}

// ── Issue ───────────────────────────────────────────────────────────────────

export interface Issue {
  id: string;
  number: number;
  title: string;
  body?: string;
  url: string;
  repoSlug: string;
  repoUrl?: string;
  labels: string[];
  difficulty: Difficulty;
  type: IssueType;
  domain: Domain[];
  language: string[];
  isGoodFirstIssue: boolean;
  gfiQualityScore?: number;
  hasMentor?: boolean;
  freshness?: Freshness;
  createdAt?: string;
  updatedAt?: string;
  commentCount?: number;
  author?: string;
}

// ── Recommendation ───────────────────────────────────────────────────────────

export interface Recommendation {
  issue: Issue;
  matchScore: number;
  matchReasons: string[];
  skillOverlap?: string[];
}

export interface RecommendationsResponse {
  userId: string;
  recommendations: Recommendation[];
  totalCandidates: number;
  cached: boolean;
}

// ── Browse / Search ──────────────────────────────────────────────────────────

export interface BrowseFilters {
  lang?: string;
  difficulty?: Difficulty | '';
  type?: IssueType | '';
  freshness?: Freshness | '';
  mentored?: boolean;
  page?: number;
  limit?: number;
}

export interface BrowseResponse {
  data: Issue[];
  total: number;
}

export interface SearchHit {
  id: string;
  title: string;
  repoSlug: string;
  difficulty: Difficulty;
  domain: Domain[];
  language: string[];
  type: IssueType;
  url: string;
  isGoodFirstIssue: boolean;
  gfiQualityScore?: number;
  hasMentor?: boolean;
  freshness?: Freshness;
  labels: string[];
  number: number;
}

export interface SearchResponse {
  hits: SearchHit[];
  estimatedTotalHits: number;
  facetDistribution?: Record<string, Record<string, number>>;
}

// ── Recommendation filters ────────────────────────────────────────────────────

export interface RecommendationFilters {
  limit?: number;
  freshness?: Freshness | '';
  type?: IssueType | '';
  mentored?: boolean;
  min_gfi_quality?: number;
}
