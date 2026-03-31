import type { IssueDoc } from '../types/issue';
import { logger } from '../api/logger';

// HuggingFace Inference API — BAAI/bge-large-en-v1.5 (1024 dimensions)
// Set HUGGINGFACE_API_KEY in .env to enable embeddings.
// Without it, embedding column stays NULL and vector matching is skipped.

const HF_ENDPOINT = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-large-en-v1.5';

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(HF_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: text }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      logger.warn({ status: res.status, err, module: 'embeddings' }, 'HuggingFace API error');
      return null;
    }

    // router returns a flat number[] of 1024 dims
    const data = await res.json() as number[][] | number[];
    const embedding = Array.isArray(data[0]) ? (data as number[][])[0] : (data as number[]);
    return embedding;
  } catch (err) {
    logger.warn({ err, module: 'embeddings' }, 'Failed to call HuggingFace API');
    return null;
  }
}

export async function runEmbeddingGenerator(
  issue: IssueDoc,
): Promise<Partial<IssueDoc>> {
  if (!process.env.HUGGINGFACE_API_KEY) return {};

  const input = `${issue.title}\n\n${issue.bodyRaw.slice(0, 500)}`;
  const embedding = await generateEmbedding(input);

  if (!embedding) return {};

  logger.debug(
    { url: issue.url, dims: embedding.length, module: 'embeddings' },
    'Embedding generated',
  );

  return { embedding };
}
