-- Migration 006: repo attribute extraction columns
-- Stores LLM-extracted attributes + section hashes for change detection

ALTER TABLE repos ADD COLUMN IF NOT EXISTS sections_hash           JSONB;  -- {section1: "sha256", ...}
ALTER TABLE repos ADD COLUMN IF NOT EXISTS repo_attributes         JSONB;  -- {base: {...}, dynamic: {...}}
ALTER TABLE repos ADD COLUMN IF NOT EXISTS attributes_extracted_at TIMESTAMPTZ;
