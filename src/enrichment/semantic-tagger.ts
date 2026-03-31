import OpenAI from 'openai';
import type { IssueDoc, ContextDepth, IssueScope } from '../types/issue';
import { logger } from '../api/logger';

// One LLM call per issue — extracts all semantic fields at once.
// Runs after tech-stack tagger so repo context (tech_stack) is available.
// Falls back silently — issue stored without semantic tags on failure.

const BASE_DOMAINS = [
  'frontend', 'backend', 'devtools', 'infrastructure', 'ml',
  'mobile', 'database', 'security', 'testing', 'docs',
] as const;

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

interface SemanticTagResult {
  domain: string[];
  skillsRequired: string[];
  contextDepth: ContextDepth;
  scope: IssueScope;
  gfiQualityScore: number;
  hasClearCriteria: boolean;
  hasReproductionSteps: boolean;
}

function buildPrompt(issue: IssueDoc): string {
  const repoDesc = (issue.rawJson as Record<string, unknown> & {
    repository?: { description?: string };
  })?.repository?.description ?? '';

  return `You are tagging a GitHub issue for an open-source contributor matching system.

Analyze this issue and return a JSON object with exactly the fields below.

Issue:
  Title: ${issue.title}
  Body: ${issue.bodyRaw.slice(0, 600)}
  Labels: ${issue.labels.join(', ') || 'none'}
  Repo tech stack: ${(issue.techStack ?? []).join(', ') || 'unknown'}
  Repo description: ${repoDesc || 'none'}

Return JSON only — no markdown, no explanation:
{
  "domain": [<strings — use these base tags when applicable: ${BASE_DOMAINS.join(', ')}. May add specific extras.>],
  "skills_required": [<specific skills a contributor needs, e.g. "React hooks", "CSS flexbox", "SQL migrations">],
  "context_depth": "<one of: none | low | medium | high — how much codebase familiarity is needed to start>",
  "scope": "<one of: isolated | cross-cutting — isolated = change in 1-2 files, cross-cutting = touches many parts>",
  "gfi_quality_score": <float 0.0–1.0 — is this genuinely a good first issue? 1.0=clear scope+context, 0.0=vague/requires deep knowledge>,
  "has_clear_criteria": <true|false — is 'done' clearly defined?>,
  "has_reproduction_steps": <true|false — for bugs: are reproduction steps provided? for non-bugs: true>
}

Scoring guide for gfi_quality_score:
  0.8–1.0: clear scope, self-contained, enough context to get started without asking
  0.5–0.7: mostly clear, might need one clarifying question
  0.2–0.4: vague, missing context, or requires deep architectural knowledge despite label
  0.0–0.2: effectively not a good first issue`;
}

function parseResult(raw: string): SemanticTagResult | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as {
      domain?: unknown;
      skills_required?: unknown;
      context_depth?: unknown;
      scope?: unknown;
      gfi_quality_score?: unknown;
      has_clear_criteria?: unknown;
      has_reproduction_steps?: unknown;
    };

    const contextDepthValues: ContextDepth[] = ['none', 'low', 'medium', 'high'];
    const scopeValues: IssueScope[] = ['isolated', 'cross-cutting'];

    const contextDepth = contextDepthValues.includes(parsed.context_depth as ContextDepth)
      ? (parsed.context_depth as ContextDepth)
      : 'low';

    const scope = scopeValues.includes(parsed.scope as IssueScope)
      ? (parsed.scope as IssueScope)
      : 'isolated';

    return {
      domain: Array.isArray(parsed.domain) ? (parsed.domain as string[]) : [],
      skillsRequired: Array.isArray(parsed.skills_required)
        ? (parsed.skills_required as string[])
        : [],
      contextDepth,
      scope,
      gfiQualityScore: typeof parsed.gfi_quality_score === 'number'
        ? Math.max(0, Math.min(1, parsed.gfi_quality_score))
        : 0.5,
      hasClearCriteria: Boolean(parsed.has_clear_criteria),
      hasReproductionSteps: Boolean(parsed.has_reproduction_steps),
    };
  } catch {
    return null;
  }
}

export async function runSemanticTagger(
  issue: IssueDoc,
): Promise<Partial<IssueDoc>> {
  if (!process.env.GROQ_API_KEY) {
    return {};
  }

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 400,
      temperature: 0.1,
      messages: [{ role: 'user', content: buildPrompt(issue) }],
    });

    const text = response.choices[0]?.message?.content ?? '';
    const result = parseResult(text);

    if (!result) {
      logger.warn({ url: issue.url, module: 'semantic-tagger' }, 'LLM returned unparseable response');
      return {};
    }

    logger.info(
      { url: issue.url, domain: result.domain, gfiQuality: result.gfiQualityScore, module: 'semantic-tagger' },
      'Semantic tags extracted',
    );

    return {
      domain: result.domain,
      skillsRequired: result.skillsRequired,
      contextDepth: result.contextDepth,
      scope: result.scope,
      gfiQualityScore: result.gfiQualityScore,
      hasClearCriteria: result.hasClearCriteria,
      hasReproductionSteps: result.hasReproductionSteps,
    };
  } catch (err) {
    logger.warn({ err, url: issue.url, module: 'semantic-tagger' }, 'Semantic tagging failed — skipping');
    return {};
  }
}
