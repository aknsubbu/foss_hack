import Redis from 'ioredis';
import { logger } from '../api/logger';

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info({ module: 'redis' }, 'Redis connected');
});

// --- Deduplication helpers ---

// Check if an issue URL has been seen before
export async function isSeen(url: string): Promise<boolean> {
  return (await redis.sismember('seen_issues', url)) === 1;
}

// Mark an issue URL as seen
export async function markSeen(url: string): Promise<void> {
  await redis.sadd('seen_issues', url);
}

// --- Cursor management ---

export async function getCursor(key: string): Promise<string | null> {
  return redis.get(`cursor:${key}`);
}

export async function setCursor(key: string, cursor: string): Promise<void> {
  await redis.set(`cursor:${key}`, cursor);
}

// --- Generic cache helpers ---

export async function cacheGet(key: string): Promise<string | null> {
  return redis.get(key);
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(key, value, 'EX', ttlSeconds);
}

// --- Repo metadata cache (6 hour TTL) ---

const REPO_META_TTL = 6 * 3600;

export async function getCachedRepoMeta(
  slug: string,
): Promise<Record<string, unknown> | null> {
  const val = await redis.get(`repo:${slug}:meta`);
  return val ? (JSON.parse(val) as Record<string, unknown>) : null;
}

export async function setCachedRepoMeta(
  slug: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await redis.set(`repo:${slug}:meta`, JSON.stringify(meta), 'EX', REPO_META_TTL);
}

export async function getCachedRepoLanguages(
  slug: string,
): Promise<string[] | null> {
  const val = await redis.get(`repo:${slug}:languages`);
  return val ? (JSON.parse(val) as string[]) : null;
}

export async function setCachedRepoLanguages(
  slug: string,
  languages: string[],
): Promise<void> {
  await redis.set(
    `repo:${slug}:languages`,
    JSON.stringify(languages),
    'EX',
    REPO_META_TTL,
  );
}

// --- Rate limit counter (sliding window) ---

export async function incrementRateLimit(
  service: string,
  windowMinutes = 60,
): Promise<number> {
  const key = `rl:${service}:${Math.floor(Date.now() / (windowMinutes * 60000))}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowMinutes * 60);
  }
  return count;
}

// --- Popular browse cache (5 min TTL) ---

export async function getCachedBrowse(
  lang: string,
): Promise<unknown[] | null> {
  const val = await redis.get(`popular:${lang}`);
  return val ? (JSON.parse(val) as unknown[]) : null;
}

export async function setCachedBrowse(
  lang: string,
  data: unknown[],
): Promise<void> {
  await redis.set(`popular:${lang}`, JSON.stringify(data), 'EX', 300);
}
