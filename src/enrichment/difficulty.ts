import OpenAI from 'openai';
import type { IssueDoc, DifficultyLabel } from '../types/issue';
import { logger } from '../api/logger';

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

// Label → difficulty mapping (case-insensitive contains match)
const EASY_LABELS = [
  'good-first-issue', 'beginner', 'easy', 'starter',
  'beginner-friendly', 'first-timers-only', 'good first issue',
];
const MEDIUM_LABELS = ['intermediate', 'moderate'];
const HARD_LABELS = ['hard', 'complex', 'advanced', 'expert'];

interface DifficultyResult {
  difficultyScore: number;
  difficultyLabel: DifficultyLabel;
}

// Single-issue rule-based pass
function ruleBasedDifficulty(issue: IssueDoc): DifficultyResult | null {
  const labelsLower = issue.labels.map((l) => l.toLowerCase());
  const matches = (targets: string[]) =>
    labelsLower.some((l) => targets.some((t) => l.includes(t)));

  if (matches(EASY_LABELS)) return { difficultyScore: 0.1, difficultyLabel: 'easy' };
  if (matches(HARD_LABELS)) return { difficultyScore: 0.85, difficultyLabel: 'hard' };
  if (matches(MEDIUM_LABELS)) return { difficultyScore: 0.5, difficultyLabel: 'medium' };
  return null;
}

// Batch classify up to 10 issues via Claude Haiku — cost: ~$0.002/batch
async function llmBatchClassify(
  issues: IssueDoc[],
): Promise<DifficultyResult[]> {
  const items = issues
    .map(
      (iss, idx) =>
        `${idx + 1}. Title: ${iss.title}\nBody: ${iss.bodyRaw.slice(0, 400)}\nLabels: ${iss.labels.join(', ')}`,
    )
    .join('\n\n');

  const prompt = `You are classifying the difficulty of GitHub issues for open-source contributors.

For each numbered issue below, respond with JSON only — an array of objects with this schema:
{ "score": <float 0-1>, "label": "easy"|"medium"|"hard" }

Score guide:
- 0.0–0.3 = easy (no deep context needed, clear scope)
- 0.4–0.6 = medium (requires understanding codebase or moderate complexity)
- 0.7–1.0 = hard (deep architectural knowledge, complex debugging, research required)

Issues:
${items}

Respond with a JSON array of ${issues.length} objects, one per issue, in the same order.`;

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.choices[0].message.content || '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('LLM returned no JSON array');

  const results = JSON.parse(jsonMatch[0]) as Array<{
    score: number;
    label: DifficultyLabel;
  }>;

  return results.map((r) => ({
    difficultyScore: r.score,
    difficultyLabel: r.label,
  }));
}

// Module entry point — processes a single issue
export async function runDifficultyClassifier(
  issue: IssueDoc,
): Promise<Partial<IssueDoc>> {
  const rule = ruleBasedDifficulty(issue);
  if (rule) return rule;

  // No conclusive label — use LLM
  try {
    const [result] = await llmBatchClassify([issue]);
    return result;
  } catch (err) {
    logger.warn(
      { err, url: issue.url, module: 'difficulty' },
      'LLM difficulty classification failed',
    );
    return {};
  }
}

// Batch entry point — called by queue worker for cost efficiency
export async function runDifficultyBatch(
  issues: IssueDoc[],
): Promise<Map<string, DifficultyResult>> {
  const results = new Map<string, DifficultyResult>();
  const needsLlm: IssueDoc[] = [];

  for (const issue of issues) {
    const rule = ruleBasedDifficulty(issue);
    if (rule) {
      results.set(issue.url, rule);
    } else {
      needsLlm.push(issue);
    }
  }

  // Process in batches of 10 to keep prompt size manageable
  const BATCH = 10;
  for (let i = 0; i < needsLlm.length; i += BATCH) {
    const batch = needsLlm.slice(i, i + BATCH);
    try {
      const llmResults = await llmBatchClassify(batch);
      batch.forEach((iss, idx) => results.set(iss.url, llmResults[idx]));
    } catch (err) {
      logger.warn({ err, module: 'difficulty' }, 'LLM batch classification failed');
    }
  }

  return results;
}
