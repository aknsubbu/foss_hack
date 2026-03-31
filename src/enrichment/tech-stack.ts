import type { IssueDoc } from '../types/issue';
import { getCachedRepoLanguages, setCachedRepoLanguages } from '../cache/redis';
import { logger } from '../api/logger';

// Normalise common language name variants for consistency
const LANGUAGE_NORMALISE: Record<string, string> = {
  'js': 'JavaScript',
  'javascript': 'JavaScript',
  'ts': 'TypeScript',
  'typescript': 'TypeScript',
  'py': 'Python',
  'python': 'Python',
  'rb': 'Ruby',
  'ruby': 'Ruby',
  'go': 'Go',
  'golang': 'Go',
  'rs': 'Rust',
  'rust': 'Rust',
  'java': 'Java',
  'kotlin': 'Kotlin',
  'swift': 'Swift',
  'dart': 'Dart',
  'cpp': 'C++',
  'c++': 'C++',
  'c': 'C',
  'csharp': 'C#',
  'c#': 'C#',
  'php': 'PHP',
};

// Framework/library regex patterns for body scanning
const FRAMEWORK_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'React', pattern: /\breact\b/i },
  { name: 'Vue', pattern: /\bvue\.?js\b|\bvuejs\b/i },
  { name: 'Angular', pattern: /\bangular\b/i },
  { name: 'Next.js', pattern: /\bnext\.?js\b|\bnextjs\b/i },
  { name: 'Nuxt', pattern: /\bnuxt\b/i },
  { name: 'Express', pattern: /\bexpress\.?js\b|\bexpressjs\b/i },
  { name: 'Fastify', pattern: /\bfastify\b/i },
  { name: 'NestJS', pattern: /\bnest\.?js\b|\bnestjs\b/i },
  { name: 'Django', pattern: /\bdjango\b/i },
  { name: 'Flask', pattern: /\bflask\b/i },
  { name: 'FastAPI', pattern: /\bfastapi\b/i },
  { name: 'Rails', pattern: /\brails\b|\bruby on rails\b/i },
  { name: 'Spring', pattern: /\bspring\s*(boot|mvc)?\b/i },
  { name: 'Laravel', pattern: /\blaravel\b/i },
  { name: 'Svelte', pattern: /\bsvelte\b/i },
  { name: 'Rust', pattern: /\btokio\b|\bactix\b|\baxum\b/i },
  { name: 'GraphQL', pattern: /\bgraphql\b/i },
  { name: 'Docker', pattern: /\bdocker\b|\bcontainer\b/i },
  { name: 'Kubernetes', pattern: /\bkubernetes\b|\bk8s\b/i },
];

// Package file → technology mapping
const PACKAGE_FILE_MAP: Record<string, string> = {
  'package.json': 'JavaScript',
  'requirements.txt': 'Python',
  'Pipfile': 'Python',
  'pyproject.toml': 'Python',
  'Cargo.toml': 'Rust',
  'go.mod': 'Go',
  'pom.xml': 'Java',
  'build.gradle': 'Kotlin',
  'pubspec.yaml': 'Dart',
  'Gemfile': 'Ruby',
  'composer.json': 'PHP',
  'Package.swift': 'Swift',
  'CMakeLists.txt': 'C++',
};

function normaliseLanguage(lang: string): string {
  return LANGUAGE_NORMALISE[lang.toLowerCase()] ?? lang;
}

async function fetchRepoLanguages(
  repoSlug: string,
  token: string,
): Promise<string[]> {
  // Check Redis cache first
  const cached = await getCachedRepoLanguages(repoSlug);
  if (cached) return cached;

  try {
    const url = `https://api.github.com/repos/${repoSlug}/languages`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as Record<string, number>;
    const langs = Object.keys(data)
      .slice(0, 5)
      .map(normaliseLanguage);

    await setCachedRepoLanguages(repoSlug, langs);
    return langs;
  } catch (err) {
    logger.warn({ err, repoSlug, module: 'tech-stack' }, 'Failed to fetch repo languages');
    return [];
  }
}

async function fetchRepoPackageFiles(
  repoSlug: string,
  token: string,
): Promise<string[]> {
  try {
    const url = `https://api.github.com/repos/${repoSlug}/contents`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) return [];

    const files = (await res.json()) as Array<{ name: string }>;
    const techs: string[] = [];
    for (const file of files) {
      const tech = PACKAGE_FILE_MAP[file.name];
      if (tech) techs.push(tech);
    }
    return techs;
  } catch {
    return [];
  }
}

function extractFrameworks(text: string): string[] {
  const found: string[] = [];
  for (const { name, pattern } of FRAMEWORK_PATTERNS) {
    if (pattern.test(text)) found.push(name);
  }
  return found;
}

export async function runTechStackTagger(
  issue: IssueDoc,
): Promise<Partial<IssueDoc>> {
  const token = process.env.GITHUB_TOKEN ?? '';
  const allTech: string[] = [];

  // Tier 1: repo languages API
  if (issue.source === 'github' && token) {
    const langs = await fetchRepoLanguages(issue.repoSlug, token);
    allTech.push(...langs);
  }

  // Tier 2: package file detection
  if (issue.source === 'github' && token) {
    const pkgTechs = await fetchRepoPackageFiles(issue.repoSlug, token);
    allTech.push(...pkgTechs);
  }

  // Tier 3: body regex scan
  const bodyTechs = extractFrameworks(
    `${issue.title} ${issue.bodyRaw}`,
  );
  allTech.push(...bodyTechs);

  // Deduplicate with case-insensitive comparison
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const tech of allTech) {
    const norm = normaliseLanguage(tech);
    const key = norm.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(norm);
    }
  }

  return { techStack: unique };
}
