-- Migration 002: issues table
-- Depends on: 001_create_repos.sql (for repos.slug reference)

CREATE TABLE IF NOT EXISTS issues (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url                   TEXT UNIQUE NOT NULL,
  external_id           TEXT,                   -- GitHub issue number or GitLab iid
  title                 TEXT NOT NULL,
  body_raw              TEXT,
  source                TEXT NOT NULL,          -- 'github' | 'gitlab' | 'gitea'
  repo_slug             TEXT REFERENCES repos(slug),
  labels                TEXT[],
  state                 TEXT DEFAULT 'open',
  created_at            TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  author                TEXT,
  comments_count        INTEGER DEFAULT 0,

  -- Enrichment fields
  difficulty_score      FLOAT,
  difficulty_label      TEXT,                   -- 'easy' | 'medium' | 'hard'
  issue_type            TEXT[],                 -- ['bug-fix', 'docs', ...]
  tech_stack            TEXT[],
  repo_health_score     FLOAT,
  repo_health           JSONB,
  freshness_label       TEXT,                   -- 'fresh' | 'active' | 'stale'
  issue_age_days        INTEGER,
  days_since_activity   INTEGER,
  is_mentored           BOOLEAN DEFAULT FALSE,
  source_list           TEXT[],
  embedding             VECTOR(1536),           -- pgvector for semantic search
  raw_json              JSONB,                  -- Original unmodified API response
  enriched_at           TIMESTAMPTZ,
  ingested_at           TIMESTAMPTZ DEFAULT NOW()
);
