/**
 * Full LLM enrichment pass on all seeded issues.
 *
 * Runs on every issue that has no domain tags yet (i.e. seeded but not LLM-enriched):
 *   - runSemanticTagger  → domain[], skillsRequired[], gfiQualityScore (Groq)
 *   - runEmbeddingGenerator → embedding vector (HuggingFace)
 *
 * Rate-limited to ~25 req/min to respect Groq free tier (30 RPM hard limit).
 * Safe to re-run — skips issues that already have domain tags AND an embedding.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/full-enrich.ts
 */
import 'dotenv/config';
import { pool, rowToIssueDoc } from '../src/db/client';
import { runSemanticTagger } from '../src/enrichment/semantic-tagger';
import { runEmbeddingGenerator } from '../src/enrichment/embeddings';
import { logger } from '../src/api/logger';

const RATE_LIMIT_MS = 2500; // 25 req/min — safely under Groq's 30 RPM

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  // Fetch issues that still need LLM enrichment
  const res = await pool.query(`
    SELECT * FROM issues
    WHERE state = 'open'
      AND (domain IS NULL OR array_length(domain, 1) IS NULL OR embedding IS NULL)
    ORDER BY created_at DESC
  `);

  logger.info({ count: res.rows.length }, 'Issues needing enrichment');

  let done = 0;
  let skipped = 0;

  for (const row of res.rows) {
    const doc = rowToIssueDoc(row as Record<string, unknown>);

    let changed = false;
    const updates: Record<string, unknown> = {};

    // 1. Semantic tags (Groq LLM)
    const needsSemantic = !doc.domain || doc.domain.length === 0;
    if (needsSemantic) {
      const patch = await runSemanticTagger(doc);
      if (patch.domain || patch.gfiQualityScore !== undefined) {
        Object.assign(updates, {
          domain: patch.domain ?? [],
          skills_required: patch.skillsRequired ?? [],
          gfi_quality_score: patch.gfiQualityScore ?? null,
          context_depth: patch.contextDepth ?? null,
          scope: patch.scope ?? null,
          has_clear_criteria: patch.hasClearCriteria ?? null,
          has_reproduction_steps: patch.hasReproductionSteps ?? null,
        });
        changed = true;
      }
      // Respect Groq rate limit
      await sleep(RATE_LIMIT_MS);
    }

    // 2. Embedding (HuggingFace)
    const needsEmbedding = !doc.embedding || doc.embedding.length === 0;
    if (needsEmbedding) {
      const patch = await runEmbeddingGenerator(doc);
      if (patch.embedding && patch.embedding.length > 0) {
        updates['embedding_vec'] = patch.embedding;
        changed = true;
      }
    }

    if (!changed) {
      skipped++;
      continue;
    }

    // Build UPDATE query dynamically
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (updates.domain !== undefined) {
      setClauses.push(`domain = $${i++}`);
      params.push(updates.domain);
    }
    if (updates.skills_required !== undefined) {
      setClauses.push(`skills_required = $${i++}`);
      params.push(updates.skills_required);
    }
    if (updates.gfi_quality_score !== undefined) {
      setClauses.push(`gfi_quality_score = $${i++}`);
      params.push(updates.gfi_quality_score);
    }
    if (updates.context_depth !== undefined) {
      setClauses.push(`context_depth = $${i++}`);
      params.push(updates.context_depth);
    }
    if (updates.scope !== undefined) {
      setClauses.push(`scope = $${i++}`);
      params.push(updates.scope);
    }
    if (updates.has_clear_criteria !== undefined) {
      setClauses.push(`has_clear_criteria = $${i++}`);
      params.push(updates.has_clear_criteria);
    }
    if (updates.has_reproduction_steps !== undefined) {
      setClauses.push(`has_reproduction_steps = $${i++}`);
      params.push(updates.has_reproduction_steps);
    }
    if (updates.embedding_vec !== undefined) {
      const vec = updates.embedding_vec as number[];
      setClauses.push(`embedding = $${i++}`);
      params.push(`[${vec.join(',')}]`);
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(doc.id);

    await pool.query(
      `UPDATE issues SET ${setClauses.join(', ')} WHERE id = $${i}`,
      params,
    );

    done++;
    if (done % 10 === 0 || done === 1) {
      logger.info(
        { done, skipped, total: res.rows.length },
        'Enrichment progress',
      );
    }
  }

  logger.info({ done, skipped, total: res.rows.length }, 'Full enrichment complete');
}

main()
  .catch((err) => {
    logger.error({ err }, 'full-enrich failed');
    process.exit(1);
  })
  .finally(() => pool.end());
