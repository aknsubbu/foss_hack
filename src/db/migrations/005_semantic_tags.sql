-- Migration 005: semantic tag columns on issues
-- LLM-generated in one call per issue via semantic-tagger module

ALTER TABLE issues ADD COLUMN IF NOT EXISTS domain                   TEXT[];
ALTER TABLE issues ADD COLUMN IF NOT EXISTS skills_required          TEXT[];
ALTER TABLE issues ADD COLUMN IF NOT EXISTS context_depth            TEXT;   -- 'none'|'low'|'medium'|'high'
ALTER TABLE issues ADD COLUMN IF NOT EXISTS scope                    TEXT;   -- 'isolated'|'cross-cutting'
ALTER TABLE issues ADD COLUMN IF NOT EXISTS gfi_quality_score        FLOAT;  -- 0-1
ALTER TABLE issues ADD COLUMN IF NOT EXISTS has_clear_criteria       BOOLEAN;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS has_reproduction_steps   BOOLEAN;

CREATE INDEX IF NOT EXISTS issues_domain_idx        ON issues USING GIN(domain);
CREATE INDEX IF NOT EXISTS issues_skills_idx        ON issues USING GIN(skills_required);
CREATE INDEX IF NOT EXISTS issues_context_depth_idx ON issues(context_depth);
CREATE INDEX IF NOT EXISTS issues_gfi_quality_idx   ON issues(gfi_quality_score DESC NULLS LAST);
