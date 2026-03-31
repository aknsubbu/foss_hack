-- Migration 007: Change embedding dimensions from 1536 (OpenAI) to 1024 (HuggingFace BAAI/bge-large-en-v1.5)
-- Guarded: only runs if the column currently has 1536 dims (i.e. the old OpenAI schema).
-- Safe to re-run — does nothing if already at 1024.

DO $$
DECLARE
  issues_dims  integer;
  users_dims   integer;
BEGIN
  -- Get current dimension of issues.embedding (atttypmod stores the dim for vector type)
  SELECT atttypmod INTO issues_dims
  FROM pg_attribute
  WHERE attrelid = 'issues'::regclass AND attname = 'embedding' AND attnum > 0;

  IF issues_dims IS NULL OR issues_dims = 1536 THEN
    DROP INDEX IF EXISTS issues_embedding_idx;
    ALTER TABLE issues DROP COLUMN IF EXISTS embedding;
    ALTER TABLE issues ADD COLUMN embedding VECTOR(1024);
    CREATE INDEX IF NOT EXISTS issues_embedding_idx ON issues
      USING hnsw (embedding vector_cosine_ops);
  END IF;

  -- Same for users
  SELECT atttypmod INTO users_dims
  FROM pg_attribute
  WHERE attrelid = 'users'::regclass AND attname = 'embedding' AND attnum > 0;

  IF users_dims IS NULL OR users_dims = 1536 THEN
    DROP INDEX IF EXISTS users_embedding_idx;
    ALTER TABLE users DROP COLUMN IF EXISTS embedding;
    ALTER TABLE users ADD COLUMN embedding VECTOR(1024);
    CREATE INDEX IF NOT EXISTS users_embedding_idx ON users
      USING hnsw (embedding vector_cosine_ops);
  END IF;
END $$;
