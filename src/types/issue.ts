// src/types/issue.ts
// Canonical type definitions for FOSSHACK data layer.
// Import from here — never redefine inline.

export type IssueSource = 'github' | 'gitlab' | 'gitea' | 'codeberg';
export type DifficultyLabel = 'easy' | 'medium' | 'hard';
export type FreshnessLabel = 'fresh' | 'active' | 'stale';
export type IssueType =
  | 'bug-fix'
  | 'feature'
  | 'documentation'
  | 'tests'
  | 'refactor'
  | 'performance'
  | 'design'
  | 'discussion';

export interface RawIssue {
  url: string;
  externalId: string;
  title: string;
  bodyRaw: string;
  source: IssueSource;
  repoSlug: string;
  labels: string[];
  state: 'open' | 'closed';
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  author: string;
  commentsCount: number;
  rawJson: Record<string, unknown>;
}

export interface RepoMeta {
  slug: string;
  source: IssueSource;
  name?: string;
  description?: string;
  htmlUrl?: string;
  starsCount?: number;
  forksCount?: number;
  openIssuesCount?: number;
  primaryLanguage?: string;
  languages?: string[];
  topics?: string[];
  isArchived?: boolean;
  daysSinceLastCommit?: number;
  avgIssueResponseHours?: number;
  repoHealthScore?: number;
}

export type ContextDepth = 'none' | 'low' | 'medium' | 'high';
export type IssueScope = 'isolated' | 'cross-cutting';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export interface IssueDoc extends RawIssue {
  id: string;
  // Structural enrichment (rule-based)
  difficultyScore?: number;
  difficultyLabel?: DifficultyLabel;
  issueType?: IssueType[];
  techStack?: string[];
  repoHealthScore?: number;
  repoHealth?: Record<string, unknown>;
  freshnessLabel?: FreshnessLabel;
  issueAgeDays?: number;
  daysSinceActivity?: number;
  isMentored?: boolean;
  sourceList?: string[];
  embedding?: number[];
  enrichedAt?: Date;
  ingestedAt?: Date;
  // Semantic enrichment (LLM-generated)
  domain?: string[];
  skillsRequired?: string[];
  contextDepth?: ContextDepth;
  scope?: IssueScope;
  gfiQualityScore?: number;
  hasClearCriteria?: boolean;
  hasReproductionSteps?: boolean;
}

export interface User {
  id: string;
  githubUsername?: string;
  displayName?: string;
  bio?: string;
  techStack?: string[];
  domains?: string[];
  experienceLevel?: ExperienceLevel;
  preferredDifficulty?: DifficultyLabel;
  preferredTypes?: IssueType[];
  skills?: string[];
  profileVersion?: number;
  embedding?: number[];
  rawProfile?: Record<string, unknown>;
  tagsGeneratedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OnboardingInput {
  githubUsername?: string;
  prompt?: string;
  techStack?: string[];
  domains?: string[];
  experienceLevel?: ExperienceLevel;
  preferredDifficulty?: DifficultyLabel;
  preferredTypes?: IssueType[];
}

// BullMQ job payloads
export interface RawIssueJobPayload {
  issue: RawIssue;
}

export interface RepoDiscoveryJobPayload {
  slug: string;
  source: IssueSource;
  htmlUrl?: string;
}

export interface ClosedIssueJobPayload {
  url: string;
  closedAt: string;
}

export interface ReEnrichJobPayload {
  issueUrl: string;
}
