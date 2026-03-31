import OpenAI from 'openai';
import type { IssueDoc, IssueType } from '../types/issue';
import { logger } from '../api/logger';

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

// Label keyword → IssueType mapping (case-insensitive contains match)
const LABEL_RULES: Array<{ type: IssueType; keywords: string[] }> = [
  { type: 'bug-fix', keywords: ['bug', 'fix', 'defect', 'regression', 'crash', 'error'] },
  { type: 'feature', keywords: ['feature', 'enhancement', 'feat', 'request', 'new'] },
  { type: 'documentation', keywords: ['doc', 'docs', 'documentation', 'readme', 'wiki'] },
  { type: 'tests', keywords: ['test', 'testing', 'coverage', 'spec', 'unit'] },
  { type: 'refactor', keywords: ['refactor', 'cleanup', 'clean-up', 'technical-debt'] },
  { type: 'performance', keywords: ['perf', 'performance', 'speed', 'memory', 'slow', 'optimize'] },
];

function ruleBasedIssueTypes(issue: IssueDoc): IssueType[] | null {
  const labelsLower = issue.labels.map((l) => l.toLowerCase());
  const titleLower = issue.title.toLowerCase();

  const matched: IssueType[] = [];
  for (const rule of LABEL_RULES) {
    const inLabel = labelsLower.some((l) =>
      rule.keywords.some((kw) => l.includes(kw)),
    );
    const inTitle = rule.keywords.some((kw) => titleLower.includes(kw));
    if (inLabel || inTitle) matched.push(rule.type);
  }

  return matched.length > 0 ? matched : null;
}

async function llmBatchClassifyTypes(
  issues: IssueDoc[],
): Promise<IssueType[][]> {
  const items = issues
    .map(
      (iss, idx) =>
        `${idx + 1}. Title: ${iss.title}\nBody: ${iss.bodyRaw.slice(0, 300)}\nLabels: ${iss.labels.join(', ')}`,
    )
    .join('\n\n');

  const validTypes = [
    'bug-fix', 'feature', 'documentation', 'tests',
    'refactor', 'performance', 'design', 'discussion',
  ];

  const prompt = `You are classifying GitHub issues by type. An issue can have multiple types.

Valid types: ${validTypes.join(', ')}

For each numbered issue, respond with a JSON array of arrays. Each inner array contains the issue types.
Example response for 2 issues: [["bug-fix"], ["feature", "documentation"]]

Issues:
${items}

Respond with a JSON array of ${issues.length} arrays only.`;

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.choices[0].message.content || '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('LLM returned no JSON array');

  return JSON.parse(jsonMatch[0]) as IssueType[][];
}

export async function runIssueTypeClassifier(
  issue: IssueDoc,
): Promise<Partial<IssueDoc>> {
  const rule = ruleBasedIssueTypes(issue);
  if (rule) return { issueType: rule };

  try {
    const [result] = await llmBatchClassifyTypes([issue]);
    return { issueType: result };
  } catch (err) {
    logger.warn(
      { err, url: issue.url, module: 'issue-type' },
      'LLM issue type classification failed',
    );
    return {};
  }
}
