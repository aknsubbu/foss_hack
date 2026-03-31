-- Migration 001: repos table
-- Requires: pgvector and pg_trgm extensions

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS repos (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    TEXT UNIQUE NOT NULL,   -- 'org/repo-name'
  source                  TEXT NOT NULL,          -- 'github' | 'gitlab' | 'gitea'
  name                    TEXT,
  description             TEXT,
  html_url                TEXT,
  stars_count             INTEGER DEFAULT 0,
  forks_count             INTEGER DEFAULT 0,
  open_issues_count       INTEGER DEFAULT 0,
  primary_language        TEXT,
  languages               TEXT[],
  topics                  TEXT[],
  is_archived             BOOLEAN DEFAULT FALSE,
  days_since_last_commit  INTEGER,
  avg_issue_response_hours FLOAT,
  repo_health_score       FLOAT,
  last_polled_at          TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);
