-- Migration 004: users table
-- Stores developer profiles built during onboarding
-- Note: vector extension already created in 001_create_repos.sql

CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_username       TEXT UNIQUE,
  display_name          TEXT,
  bio                   TEXT,
  tech_stack            TEXT[],
  domains               TEXT[],
  experience_level      TEXT,           -- 'beginner' | 'intermediate' | 'advanced'
  preferred_difficulty  TEXT,           -- 'easy' | 'medium' | 'hard'
  preferred_types       TEXT[],         -- ['bug-fix', 'feature', ...]
  skills                TEXT[],         -- specific skills (mirrors issue.skills_required)
  profile_version       INTEGER DEFAULT 1,
  embedding             VECTOR(1536),
  raw_profile           JSONB,
  tags_generated_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_github_username_idx ON users(github_username);
CREATE INDEX IF NOT EXISTS users_domains_idx         ON users USING GIN(domains);
CREATE INDEX IF NOT EXISTS users_tech_stack_idx      ON users USING GIN(tech_stack);
CREATE INDEX IF NOT EXISTS users_skills_idx          ON users USING GIN(skills);
CREATE INDEX IF NOT EXISTS users_embedding_idx       ON users
  USING hnsw (embedding vector_cosine_ops);
