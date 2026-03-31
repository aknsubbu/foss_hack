/**
 * Day 1 Demo Seed Script
 *
 * Fetches top open issues from curated repos using GitHub REST API.
 * Runs rule-based enrichment only (no LLM calls) for fast demo setup.
 * Idempotent — safe to run multiple times.
 */

import { upsertIssue, upsertRepo } from './client';
import { syncIssueToSearch } from '../search/meilisearch';
import { normalise } from '../enrichment/normaliser';
import { runDifficultyClassifier } from '../enrichment/difficulty';
import { runIssueTypeClassifier } from '../enrichment/issue-type';
import { runFreshnessTracker } from '../enrichment/freshness';
import { runMentorshipSignal } from '../enrichment/mentorship';
import { logger } from '../api/logger';
import type { RawIssue, IssueDoc, RepoMeta } from '../types/issue';

const SEED_REPOS = [
  // Frontend
  'facebook/react',
  'vuejs/vue',
  'angular/angular',
  'sveltejs/svelte',
  'vercel/next.js',
  'nuxt/nuxt',
  'solidjs/solid',
  'remix-run/remix',

  // Backend / Node
  'fastify/fastify',
  'nestjs/nest',
  'expressjs/express',
  'koajs/koa',
  'trpc/trpc',

  // DevTools / Tooling
  'microsoft/vscode',
  'prettier/prettier',
  'biomejs/biome',
  'vitejs/vite',
  'evanw/esbuild',
  'rollup/rollup',

  // Systems / Languages
  'denoland/deno',
  'rust-lang/rust',
  'golang/go',
  'nickel-lang/nickel',

  // Python / Data
  'django/django',
  'pallets/flask',
  'psf/requests',
  'tiangolo/fastapi',
  'pydantic/pydantic',
  'encode/httpx',

  // ML / AI
  'huggingface/transformers',
  'keras-team/keras',
  'scikit-learn/scikit-learn',
  'langchain-ai/langchain',

  // Mobile
  'flutter/flutter',
  'facebook/react-native',

  // Database / ORM
  'prisma/prisma',
  'typeorm/typeorm',
  'drizzle-team/drizzle-orm',

  // Testing
  'jestjs/jest',
  'vitest-dev/vitest',
  'testing-library/react-testing-library',

  // Infrastructure / DevOps
  'docker/compose',
  'grafana/grafana',

  // Docs / Learn
  'facebook/docusaurus',
  'EbookFoundation/free-programming-books',
  'firstcontributions/first-contributions',
  'public-apis/public-apis',

  // Ruby
  'rails/rails',

  // Frontend — UI / Component libs
  'storybookjs/storybook',
  'radix-ui/primitives',
  'tailwindlabs/tailwindcss',
  'tanstack/query',
  'tanstack/router',
  'preactjs/preact',
  'alpinejs/alpine',
  'withastro/astro',
  'lit/lit',

  // Backend — servers / APIs
  'honojs/hono',
  'strapi/strapi',
  'directus/directus',
  'supabase/supabase',
  'medusajs/medusa',
  'payloadcms/payload',
  'refinedev/refine',

  // DevTools / Bundlers / Compilers
  'oven-sh/bun',
  'swc-project/swc',
  'microsoft/TypeScript',
  'microsoft/playwright',
  'rome/tools',
  'tree-sitter/tree-sitter',
  'nickel-lang/nickel',
  'gleam-lang/gleam',

  // Infrastructure / CLI
  'cli/cli',
  'pulumi/pulumi',
  'earthly/earthly',
  'caddyserver/caddy',
  'traefik/traefik',

  // Testing
  'mochajs/mocha',
  'cypress-io/cypress',
  'microsoft/playwright-python',

  // ML / AI / Data
  'openai/openai-python',
  'langchain-ai/langchainjs',
  'BerriAI/litellm',
  'AUTOMATIC1111/stable-diffusion-webui',
  'Significant-Gravitas/AutoGPT',

  // Mobile / Cross-platform
  'ionic-team/ionic-framework',
  'expo/expo',
  'tauri-apps/tauri',

  // Database / ORM
  'sequelize/sequelize',
  'MikroORM/mikro-orm',
  'knex/knex',

  // Docs / Static sites
  'withastro/starlight',
  'vuejs/vuepress',
  'facebook/docusaurus',

  // Security / Auth
  'supertokens/supertokens-node',
  'lucia-auth/lucia',
];

interface GitHubIssue {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  user?: { login: string };
  comments: number;
  labels: Array<{ name: string }>;
}

interface GitHubRepo {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics?: string[];
  archived: boolean;
  pushed_at: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  retries = 3,
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 || res.status >= 500) {
      const delay = Math.min(1000 * 2 ** i + Math.random() * 200, 60000);
      logger.warn({ url, status: res.status }, `Rate limited — waiting ${delay}ms`);
      await sleep(delay);
      continue;
    }
    return res;
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

async function seedRepo(slug: string, token: string): Promise<number> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
  };

  // Fetch repo metadata
  const repoRes = await fetchWithRetry(
    `https://api.github.com/repos/${slug}`,
    headers,
  );
  if (!repoRes.ok) {
    logger.warn({ slug, status: repoRes.status }, 'Failed to fetch repo metadata');
    return 0;
  }
  const repoData = (await repoRes.json()) as GitHubRepo;

  const daysSinceLastCommit = Math.floor(
    (Date.now() - new Date(repoData.pushed_at).getTime()) / 86400000,
  );

  const repoMeta: RepoMeta = {
    slug: repoData.full_name.toLowerCase(),
    source: 'github',
    name: repoData.name,
    description: repoData.description ?? undefined,
    htmlUrl: repoData.html_url,
    starsCount: repoData.stargazers_count,
    forksCount: repoData.forks_count,
    openIssuesCount: repoData.open_issues_count,
    primaryLanguage: repoData.language ?? undefined,
    topics: repoData.topics ?? [],
    isArchived: repoData.archived,
    daysSinceLastCommit,
  };
  await upsertRepo(repoMeta);

  // Fetch open good-first-issues
  let page = 1;
  let totalIngested = 0;

  while (page <= 3) { // Max 3 pages = 300 issues per repo for seed
    const issuesUrl = `https://api.github.com/repos/${slug}/issues?state=open&labels=good+first+issue&per_page=100&page=${page}`;
    const issuesRes = await fetchWithRetry(issuesUrl, headers);
    if (!issuesRes.ok) break;

    const issues = (await issuesRes.json()) as GitHubIssue[];
    if (issues.length === 0) break;

    for (const ghIssue of issues) {
      // Filter out pull requests (GitHub REST returns PRs in issues endpoint)
      if (ghIssue.html_url.includes('/pull/')) continue;

      const raw: RawIssue = {
        url: ghIssue.html_url,
        externalId: String(ghIssue.number),
        title: ghIssue.title,
        bodyRaw: ghIssue.body ?? '',
        source: 'github',
        repoSlug: repoData.full_name.toLowerCase(),
        labels: ghIssue.labels.map((l) => l.name),
        state: (ghIssue.state as 'open' | 'closed') ?? 'open',
        createdAt: new Date(ghIssue.created_at),
        updatedAt: new Date(ghIssue.updated_at),
        closedAt: ghIssue.closed_at ? new Date(ghIssue.closed_at) : undefined,
        author: ghIssue.user?.login ?? 'unknown',
        commentsCount: ghIssue.comments,
        rawJson: ghIssue as unknown as Record<string, unknown>,
      };

      // Rule-based enrichment only for Day 1 seed (fast, no API cost)
      const doc: IssueDoc = normalise(raw);
      const patches = await Promise.all([
        runDifficultyClassifier(doc),
        runIssueTypeClassifier(doc),
        runFreshnessTracker(doc),
        runMentorshipSignal(doc),
      ]);
      for (const patch of patches) Object.assign(doc, patch);

      // Add tech stack from repo's primary language
      if (repoData.language) {
        doc.techStack = [repoData.language];
      }
      doc.enrichedAt = new Date();

      await upsertIssue(doc);
      await syncIssueToSearch(doc);
      totalIngested++;
    }

    page++;
    await sleep(500); // Be polite to the API
  }

  return totalIngested;
}

export async function runSeed(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required for seeding');
  }

  logger.info({ repos: SEED_REPOS.length }, 'Starting Day 1 seed');

  let total = 0;
  for (const slug of SEED_REPOS) {
    try {
      const count = await seedRepo(slug, token);
      total += count;
      logger.info({ slug, count, totalSoFar: total }, 'Repo seeded');
    } catch (err) {
      logger.error({ err, slug }, 'Failed to seed repo — continuing');
    }
    await sleep(1000);
  }

  logger.info({ total }, `Seed complete — ${total} issues ingested`);
}
