import OpenAI from 'openai';
import type { User, OnboardingInput, ExperienceLevel, DifficultyLabel, IssueType } from '../types/issue';
import { upsertUser, insertUser } from '../db/users';
import { generateEmbedding } from '../enrichment/embeddings';
import { logger } from '../api/logger';

// Groq client for tag extraction
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

// --- GitHub profile fetcher ---

interface GithubProfile {
  login: string;
  name?: string;
  bio?: string;
  company?: string;
  languages: string[];
  repoDescriptions: string[];
  topics: string[];
}

async function fetchGithubProfile(username: string): Promise<GithubProfile | null> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    // Fetch user
    const userRes = await fetch(`https://api.github.com/users/${username}`, { headers });
    if (!userRes.ok) return null;
    const user = await userRes.json() as Record<string, unknown>;

    // Fetch their repos (recently pushed, not forks, up to 30)
    const reposRes = await fetch(
      `https://api.github.com/users/${username}/repos?sort=pushed&per_page=30&type=owner`,
      { headers },
    );
    const repos = reposRes.ok
      ? (await reposRes.json() as Array<Record<string, unknown>>)
      : [];

    const languages = new Set<string>();
    const topics = new Set<string>();
    const repoDescriptions: string[] = [];

    for (const repo of repos) {
      if (repo.fork) continue;
      if (repo.language) languages.add(repo.language as string);
      ((repo.topics as string[]) ?? []).forEach((t) => topics.add(t));
      if (repo.description) repoDescriptions.push(repo.description as string);
    }

    return {
      login: username,
      name: user.name as string | undefined,
      bio: user.bio as string | undefined,
      company: user.company as string | undefined,
      languages: Array.from(languages).slice(0, 10),
      repoDescriptions: repoDescriptions.slice(0, 10),
      topics: Array.from(topics).slice(0, 15),
    };
  } catch (err) {
    logger.warn({ err, username, module: 'onboarding' }, 'Failed to fetch GitHub profile');
    return null;
  }
}

// --- LLM tag extraction ---

const BASE_DOMAINS = [
  'frontend', 'backend', 'devtools', 'infrastructure', 'ml',
  'mobile', 'database', 'security', 'testing', 'docs',
];

interface ExtractedTags {
  techStack: string[];
  domains: string[];
  skills: string[];
  experienceLevel: ExperienceLevel;
  preferredDifficulty: DifficultyLabel;
  preferredTypes: IssueType[];
  displayName?: string;
}

async function extractUserTags(
  input: OnboardingInput,
  githubProfile: GithubProfile | null,
): Promise<ExtractedTags> {
  const contextParts: string[] = [];

  if (githubProfile) {
    contextParts.push(`GitHub username: ${githubProfile.login}`);
    if (githubProfile.name) contextParts.push(`Name: ${githubProfile.name}`);
    if (githubProfile.bio) contextParts.push(`Bio: ${githubProfile.bio}`);
    if (githubProfile.languages.length > 0)
      contextParts.push(`Languages used in repos: ${githubProfile.languages.join(', ')}`);
    if (githubProfile.topics.length > 0)
      contextParts.push(`Repo topics: ${githubProfile.topics.join(', ')}`);
    if (githubProfile.repoDescriptions.length > 0)
      contextParts.push(`Repo descriptions: ${githubProfile.repoDescriptions.slice(0, 5).join(' | ')}`);
  }

  if (input.prompt) contextParts.push(`Developer's own words: "${input.prompt}"`);
  if (input.techStack?.length) contextParts.push(`Self-reported tech: ${input.techStack.join(', ')}`);
  if (input.domains?.length) contextParts.push(`Interested domains: ${input.domains.join(', ')}`);
  if (input.experienceLevel) contextParts.push(`Self-reported level: ${input.experienceLevel}`);
  if (input.preferredDifficulty) contextParts.push(`Preferred difficulty: ${input.preferredDifficulty}`);

  const prompt = `You are building a developer profile for an open-source contributor matching system.

Context about this developer:
${contextParts.join('\n')}

Based on this information, extract a structured profile. Return JSON only — no markdown:
{
  "tech_stack": [<languages and frameworks they know, normalized e.g. "TypeScript" not "ts">],
  "domains": [<areas from this list: ${BASE_DOMAINS.join(', ')} — pick what fits, may include unlisted extras>],
  "skills": [<specific skills, e.g. "React hooks", "REST API design", "SQL migrations", "Docker Compose">],
  "experience_level": "<beginner | intermediate | advanced>",
  "preferred_difficulty": "<easy | medium | hard — infer from experience level if not stated>",
  "preferred_types": [<subset of: bug-fix, feature, documentation, tests, refactor, performance, design, discussion>],
  "display_name": "<their name if known, else null>"
}

Rules:
- experience_level: beginner = learning/junior, intermediate = 1-3 years, advanced = senior/expert
- preferred_difficulty: beginners → easy, intermediate → medium, advanced → any
- preferred_types: infer from interests if not stated (e.g. "I want to learn" → feature/docs, "I fix bugs" → bug-fix)
- tech_stack and skills should be specific but not exhaustive`;

  const experienceLevels: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced'];
  const difficultyLabels: DifficultyLabel[] = ['easy', 'medium', 'hard'];

  // Fallback: use form input directly when LLM is unavailable (rate limit, quota, etc.)
  const fallback: ExtractedTags = {
    techStack: input.techStack ?? (githubProfile?.languages ?? []),
    domains: (input.domains as string[]) ?? [],
    skills: [],
    experienceLevel: experienceLevels.includes(input.experienceLevel as ExperienceLevel)
      ? (input.experienceLevel as ExperienceLevel)
      : 'beginner',
    preferredDifficulty: difficultyLabels.includes(input.preferredDifficulty as DifficultyLabel)
      ? (input.preferredDifficulty as DifficultyLabel)
      : 'easy',
    preferredTypes: (input.preferredTypes as IssueType[]) ?? [],
    displayName: githubProfile?.name,
  };

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.warn({ module: 'onboarding' }, 'LLM returned no JSON — using form input as-is');
      return fallback;
    }

    const parsed = JSON.parse(match[0]) as {
      tech_stack?: string[];
      domains?: string[];
      skills?: string[];
      experience_level?: string;
      preferred_difficulty?: string;
      preferred_types?: string[];
      display_name?: string | null;
    };

    return {
      techStack: Array.isArray(parsed.tech_stack) ? parsed.tech_stack : fallback.techStack,
      domains: Array.isArray(parsed.domains) ? parsed.domains : fallback.domains,
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      experienceLevel: experienceLevels.includes(parsed.experience_level as ExperienceLevel)
        ? (parsed.experience_level as ExperienceLevel)
        : fallback.experienceLevel,
      preferredDifficulty: difficultyLabels.includes(parsed.preferred_difficulty as DifficultyLabel)
        ? (parsed.preferred_difficulty as DifficultyLabel)
        : fallback.preferredDifficulty,
      preferredTypes: Array.isArray(parsed.preferred_types)
        ? (parsed.preferred_types as IssueType[])
        : fallback.preferredTypes,
      displayName: parsed.display_name ?? githubProfile?.name,
    };
  } catch (err) {
    logger.warn({ err, module: 'onboarding' }, 'Groq unavailable — using form input directly');
    return fallback;
  }
}

// --- Embedding generation ---

async function generateUserEmbedding(tags: ExtractedTags, prompt?: string): Promise<number[] | null> {
  const input = [
    `${tags.experienceLevel} developer`,
    `Interested in: ${tags.domains.join(', ')}`,
    `Skills: ${tags.skills.join(', ')}`,
    `Tech: ${tags.techStack.join(', ')}`,
    prompt ? `Goal: ${prompt}` : '',
  ].filter(Boolean).join('. ');

  return generateEmbedding(input);
}

// --- Main onboarding orchestrator ---

export async function onboardUser(input: OnboardingInput): Promise<User> {
  logger.info({ githubUsername: input.githubUsername, module: 'onboarding' }, 'Starting user onboarding');

  // Fetch GitHub profile if username provided
  const githubProfile = input.githubUsername
    ? await fetchGithubProfile(input.githubUsername)
    : null;

  // Extract structured tags via LLM
  const tags = await extractUserTags(input, githubProfile);

  // Generate embedding
  const embedding = await generateUserEmbedding(tags, input.prompt);

  const userPayload: Omit<User, 'id'> = {
    githubUsername: input.githubUsername,
    displayName: tags.displayName,
    bio: input.prompt,
    techStack: tags.techStack,
    domains: tags.domains,
    experienceLevel: tags.experienceLevel,
    preferredDifficulty: tags.preferredDifficulty,
    preferredTypes: tags.preferredTypes,
    skills: tags.skills,
    embedding: embedding ?? undefined,
    rawProfile: { input, githubProfile },
    tagsGeneratedAt: new Date(),
  };

  // Upsert if github_username present (idempotent), insert otherwise
  const user = input.githubUsername
    ? await upsertUser(userPayload)
    : await insertUser(userPayload);

  logger.info(
    { userId: user.id, domains: user.domains, experienceLevel: user.experienceLevel, module: 'onboarding' },
    'User onboarded',
  );

  return user;
}
