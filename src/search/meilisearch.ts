import { MeiliSearch } from 'meilisearch';
import { logger } from '../api/logger';
import type { IssueDoc } from '../types/issue';

export const searchClient = new MeiliSearch({
  host: process.env.MEILISEARCH_URL ?? 'http://localhost:7700',
  apiKey: process.env.MEILISEARCH_KEY ?? 'masterKey',
});

const INDEX_NAME = 'issues';

// Configure Meilisearch index settings — call once on startup
export async function configureMeilisearch(): Promise<void> {
  try {
    const index = searchClient.index(INDEX_NAME);
    await index.updateSettings({
      searchableAttributes: ['title', 'body_raw', 'repo_slug', 'tech_stack'],
      filterableAttributes: [
        'tech_stack',
        'difficulty_label',
        'issue_type',
        'freshness_label',
        'source',
        'is_mentored',
        'state',
      ],
      sortableAttributes: ['created_at', 'updated_at', 'repo_health_score'],
      rankingRules: [
        'words',
        'typo',
        'proximity',
        'attribute',
        'sort',
        'exactness',
      ],
    });
    logger.info({ module: 'meilisearch' }, 'Meilisearch index configured');
  } catch (err) {
    logger.error({ err, module: 'meilisearch' }, 'Failed to configure Meilisearch');
    throw err;
  }
}

// Sync a single issue to Meilisearch — omits raw_json and embedding (too large)
export async function syncIssueToSearch(doc: IssueDoc): Promise<void> {
  try {
    const { rawJson: _rawJson, embedding: _embedding, ...searchDoc } = doc;

    // Meilisearch needs a string primary key — use `url`
    const meiliDoc = {
      ...searchDoc,
      id: doc.url, // override UUID with URL as primary key for Meilisearch
      uuid: doc.id, // preserve the DB UUID
      created_at: doc.createdAt?.toISOString(),
      updated_at: doc.updatedAt?.toISOString(),
    };

    await searchClient.index(INDEX_NAME).addDocuments([meiliDoc], {
      primaryKey: 'id',
    });
  } catch (err) {
    logger.warn({ err, url: doc.url, module: 'meilisearch' }, 'Failed to sync issue to Meilisearch');
  }
}

// Full-text search with facets
export interface SearchOptions {
  q: string;
  lang?: string | string[];
  difficulty?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  hits: IssueDoc[];
  estimatedTotalHits: number;
  facetDistribution: Record<string, Record<string, number>>;
}

export async function searchIssues(opts: SearchOptions): Promise<SearchResult> {
  const filters: string[] = ["state = 'open'"];

  if (opts.lang) {
    const langs = Array.isArray(opts.lang) ? opts.lang : [opts.lang];
    filters.push(`tech_stack IN [${langs.map((l) => `"${l}"`).join(', ')}]`);
  }
  if (opts.difficulty) {
    filters.push(`difficulty_label = "${opts.difficulty}"`);
  }
  if (opts.type) {
    filters.push(`issue_type = "${opts.type}"`);
  }

  const result = await searchClient.index(INDEX_NAME).search(opts.q, {
    filter: filters.length > 1 ? filters.join(' AND ') : filters[0],
    limit: opts.limit ?? 20,
    offset: opts.offset ?? 0,
    facets: ['tech_stack', 'difficulty_label', 'issue_type', 'freshness_label'],
  });

  return {
    hits: result.hits as unknown as IssueDoc[],
    estimatedTotalHits: result.estimatedTotalHits ?? 0,
    facetDistribution: (result.facetDistribution ?? {}) as Record<
      string,
      Record<string, number>
    >,
  };
}

// Health check
export async function checkMeilisearchHealth(): Promise<boolean> {
  try {
    const health = await searchClient.health();
    return health.status === 'available';
  } catch {
    return false;
  }
}
