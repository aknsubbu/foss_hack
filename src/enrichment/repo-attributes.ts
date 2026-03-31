import crypto from 'crypto';
import OpenAI from 'openai';
import { pool } from '../db/client';
import { logger } from '../api/logger';

// Extracts structured attributes from each repo by fetching 4 sections of content,
// hashing each section, and only calling the LLM when content has changed.

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

interface SectionContent {
  section1: string; // repo metadata
  section2: string; // README
  section3: string; // CONTRIBUTING
  section4: string; // recent issue titles
}

interface SectionHashes {
  section1?: string;
  section2?: string;
  section3?: string;
  section4?: string;
}

interface RepoAttributes {
  base: {
    projectType: string;
    primaryDomain: string;
    beginnerFriendliness: number;
    hasContributingGuide: boolean;
    setupComplexity: string;
  };
  dynamic: {
    activeAreas: string[];
    maintainerResponsiveness: string;
    currentFocus: string;
  };
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// --- Section fetchers ---

async function fetchSection1(slug: string, row: Record<string, unknown>): Promise<string> {
  return [
    `Repo: ${slug}`,
    `Description: ${row.description ?? 'none'}`,
    `Language: ${row.primary_language ?? 'unknown'}`,
    `Stars: ${row.stars_count ?? 0}`,
    `Topics: ${(row.topics as string[] | null)?.join(', ') ?? 'none'}`,
    `Archived: ${row.is_archived ?? false}`,
  ].join('\n');
}

async function fetchSection2(slug: string, token: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${slug}/readme`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.raw',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!res.ok) return '';
    const text = await res.text();
    return text.slice(0, 1500);
  } catch {
    return '';
  }
}

async function fetchSection3(slug: string, token: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${slug}/contents/CONTRIBUTING.md`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.raw',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!res.ok) return '';
    const text = await res.text();
    return text.slice(0, 1500);
  } catch {
    return '';
  }
}

async function fetchSection4(slug: string, token: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${slug}/issues?state=open&per_page=10&sort=updated`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!res.ok) return '';
    const issues = await res.json() as Array<{ title?: string }>;
    return issues.map((i, idx) => `${idx + 1}. ${i.title ?? ''}`).join('\n');
  } catch {
    return '';
  }
}

// --- LLM attribute extraction ---

async function extractAttributes(
  slug: string,
  sections: SectionContent,
  existingAttrs?: RepoAttributes,
): Promise<RepoAttributes> {
  const prompt = `Extract structured attributes for this open-source repository.

${sections.section1}

README (first 1500 chars):
${sections.section2 || '(not available)'}

CONTRIBUTING guide:
${sections.section3 || '(not available)'}

Recent open issues:
${sections.section4 || '(none)'}

Return JSON only:
{
  "base": {
    "project_type": "<library | framework | app | tool | docs | infrastructure>",
    "primary_domain": "<frontend | backend | devtools | infrastructure | ml | mobile | database | security | testing | docs>",
    "beginner_friendliness": <float 0-1>,
    "has_contributing_guide": <true|false>,
    "setup_complexity": "<low | medium | high>"
  },
  "dynamic": {
    "active_areas": [<up to 3 strings describing what the repo is currently working on>],
    "maintainer_responsiveness": "<high | medium | low>",
    "current_focus": "<one sentence describing the repo's current main focus>"
  }
}`;

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 400,
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.choices[0]?.message?.content ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    logger.warn({ slug, module: 'repo-attributes' }, 'LLM returned no JSON');
    return existingAttrs ?? {
      base: { projectType: 'unknown', primaryDomain: 'backend', beginnerFriendliness: 0.5, hasContributingGuide: false, setupComplexity: 'medium' },
      dynamic: { activeAreas: [], maintainerResponsiveness: 'medium', currentFocus: '' },
    };
  }

  const parsed = JSON.parse(match[0]) as {
    base?: Record<string, unknown>;
    dynamic?: Record<string, unknown>;
  };

  return {
    base: {
      projectType: (parsed.base?.project_type as string) ?? 'tool',
      primaryDomain: (parsed.base?.primary_domain as string) ?? 'backend',
      beginnerFriendliness: typeof parsed.base?.beginner_friendliness === 'number'
        ? parsed.base.beginner_friendliness : 0.5,
      hasContributingGuide: Boolean(parsed.base?.has_contributing_guide),
      setupComplexity: (parsed.base?.setup_complexity as string) ?? 'medium',
    },
    dynamic: {
      activeAreas: Array.isArray(parsed.dynamic?.active_areas)
        ? (parsed.dynamic!.active_areas as string[])
        : [],
      maintainerResponsiveness: (parsed.dynamic?.maintainer_responsiveness as string) ?? 'medium',
      currentFocus: (parsed.dynamic?.current_focus as string) ?? '',
    },
  };
}

// --- Main runner ---

export async function runRepoAttributeExtractor(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logger.warn({ module: 'repo-attributes' }, 'GITHUB_TOKEN not set — skipping');
    return;
  }

  const reposRes = await pool.query(
    `SELECT slug, description, primary_language, stars_count, topics, is_archived,
            sections_hash, repo_attributes
     FROM repos
     WHERE source = 'github'
     ORDER BY last_polled_at DESC NULLS LAST
     LIMIT 200`,
  );

  logger.info({ count: reposRes.rows.length, module: 'repo-attributes' }, 'Starting repo attribute extraction');

  let processed = 0;
  let skipped = 0;

  for (const row of reposRes.rows as Record<string, unknown>[]) {
    const slug = row.slug as string;

    try {
      // Fetch all 4 sections
      const [s2, s3, s4] = await Promise.all([
        fetchSection2(slug, token),
        fetchSection3(slug, token),
        fetchSection4(slug, token),
      ]);
      const s1 = await fetchSection1(slug, row);

      const sections: SectionContent = {
        section1: s1,
        section2: s2,
        section3: s3,
        section4: s4,
      };

      // Compute new hashes
      const newHashes: SectionHashes = {
        section1: sha256(s1),
        section2: sha256(s2),
        section3: sha256(s3),
        section4: sha256(s4),
      };

      const storedHashes = (row.sections_hash as SectionHashes | null) ?? {};

      // Check which sections changed
      const changed = (Object.keys(newHashes) as Array<keyof SectionHashes>).filter(
        (k) => newHashes[k] !== storedHashes[k],
      );

      if (changed.length === 0) {
        skipped++;
        continue;
      }

      // Extract attributes for changed sections
      const existingAttrs = row.repo_attributes as RepoAttributes | null;
      const attrs = await extractAttributes(slug, sections, existingAttrs ?? undefined);

      await pool.query(
        `UPDATE repos
         SET sections_hash = $2,
             repo_attributes = $3,
             attributes_extracted_at = NOW()
         WHERE slug = $1`,
        [slug, JSON.stringify(newHashes), JSON.stringify(attrs)],
      );

      processed++;
      logger.info({ slug, changed, module: 'repo-attributes' }, 'Repo attributes updated');

      // Rate limit: 1 request per second
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      logger.warn({ err, slug, module: 'repo-attributes' }, 'Failed to extract repo attributes');
    }
  }

  logger.info({ processed, skipped, module: 'repo-attributes' }, 'Repo attribute extraction complete');
}
