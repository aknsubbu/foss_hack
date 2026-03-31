-- Migration 003: performance indexes
-- Depends on: 002_create_issues.sql

-- Deduplication and state queries
CREATE INDEX IF NOT EXISTS idx_issues_url ON issues(url);
CREATE INDEX IF NOT EXISTS idx_issues_repo_state ON issues(repo_slug, state);
CREATE INDEX IF NOT EXISTS idx_issues_state ON issues(state);

-- Array containment queries for tech_stack and issue_type
CREATE INDEX IF NOT EXISTS idx_issues_tech_stack ON issues USING GIN(tech_stack);
CREATE INDEX IF NOT EXISTS idx_issues_issue_type ON issues USING GIN(issue_type);

-- Filtered browse queries (composite for common filter combos)
CREATE INDEX IF NOT EXISTS idx_issues_filters ON issues(difficulty_label, freshness_label, state);

-- Vector similarity (HNSW for Approximate Nearest Neighbour — much faster than IVFFlat)
CREATE INDEX IF NOT EXISTS idx_issues_embedding ON issues USING hnsw(embedding vector_cosine_ops);

-- Repo slug lookup
CREATE INDEX IF NOT EXISTS idx_repos_slug ON repos(slug);

-- Trigram index for ILIKE searches on title
CREATE INDEX IF NOT EXISTS idx_issues_title_trgm ON issues USING GIN(title gin_trgm_ops);
