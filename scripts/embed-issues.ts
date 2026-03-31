/**
 * One-shot script: generate HuggingFace embeddings for all issues that don't have one.
 * Run after the seed: ts-node --transpile-only scripts/embed-issues.ts
 */
import 'dotenv/config';
import { pool, upsertIssue, rowToIssueDoc } from '../src/db/client';
import { runEmbeddingGenerator } from '../src/enrichment/embeddings';
import { logger } from '../src/api/logger';

async function main(): Promise<void> {
  const res = await pool.query(
    `SELECT * FROM issues WHERE embedding IS NULL AND state = 'open' ORDER BY created_at DESC`,
  );

  logger.info({ count: res.rows.length }, 'Issues without embeddings');

  let done = 0;
  for (const row of res.rows) {
    const doc = rowToIssueDoc(row as Record<string, unknown>);
    const patch = await runEmbeddingGenerator(doc);

    if (patch.embedding && patch.embedding.length > 0) {
      await pool.query(
        `UPDATE issues SET embedding = $1, updated_at = NOW() WHERE id = $2`,
        [`[${patch.embedding.join(',')}]`, doc.id],
      );
      done++;
      if (done % 10 === 0) {
        logger.info({ done, total: res.rows.length }, 'Progress');
      }
    }
  }

  logger.info({ done, total: res.rows.length }, 'Embedding complete');
}

main()
  .catch((err) => {
    logger.error({ err }, 'embed-issues failed');
    process.exit(1);
  })
  .finally(() => pool.end());
