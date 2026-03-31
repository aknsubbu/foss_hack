import { pool } from './client';
import { logger } from '../api/logger';
import type { User } from '../types/issue';

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    githubUsername: row.github_username as string | undefined,
    displayName: row.display_name as string | undefined,
    bio: row.bio as string | undefined,
    techStack: (row.tech_stack as string[]) ?? [],
    domains: (row.domains as string[]) ?? [],
    experienceLevel: row.experience_level as User['experienceLevel'],
    preferredDifficulty: row.preferred_difficulty as User['preferredDifficulty'],
    preferredTypes: (row.preferred_types as User['preferredTypes']) ?? [],
    skills: (row.skills as string[]) ?? [],
    profileVersion: (row.profile_version as number) ?? 1,
    embedding: row.embedding
      ? (row.embedding as string)
          .replace(/^\[/, '')
          .replace(/\]$/, '')
          .split(',')
          .map(Number)
      : undefined,
    rawProfile: (row.raw_profile as Record<string, unknown>) ?? {},
    tagsGeneratedAt: row.tags_generated_at ? new Date(row.tags_generated_at as string) : undefined,
    createdAt: row.created_at ? new Date(row.created_at as string) : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at as string) : undefined,
  };
}

export async function upsertUser(user: Omit<User, 'id'> & { id?: string }): Promise<User> {
  const embeddingStr = user.embedding
    ? `[${user.embedding.join(',')}]`
    : null;

  const sql = `
    INSERT INTO users (
      github_username, display_name, bio,
      tech_stack, domains, experience_level,
      preferred_difficulty, preferred_types, skills,
      embedding, raw_profile, tags_generated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (github_username) DO UPDATE SET
      display_name        = COALESCE(EXCLUDED.display_name,        users.display_name),
      bio                 = COALESCE(EXCLUDED.bio,                 users.bio),
      tech_stack          = EXCLUDED.tech_stack,
      domains             = EXCLUDED.domains,
      experience_level    = EXCLUDED.experience_level,
      preferred_difficulty= EXCLUDED.preferred_difficulty,
      preferred_types     = EXCLUDED.preferred_types,
      skills              = EXCLUDED.skills,
      embedding           = COALESCE(EXCLUDED.embedding,           users.embedding),
      raw_profile         = EXCLUDED.raw_profile,
      tags_generated_at   = EXCLUDED.tags_generated_at,
      profile_version     = users.profile_version + 1,
      updated_at          = NOW()
    RETURNING *
  `;

  const res = await pool.query(sql, [
    user.githubUsername ?? null,
    user.displayName ?? null,
    user.bio ?? null,
    user.techStack ?? [],
    user.domains ?? [],
    user.experienceLevel ?? null,
    user.preferredDifficulty ?? null,
    user.preferredTypes ?? [],
    user.skills ?? [],
    embeddingStr,
    user.rawProfile ? JSON.stringify(user.rawProfile) : null,
    user.tagsGeneratedAt ?? new Date(),
  ]);

  return rowToUser(res.rows[0]);
}

// Insert without ON CONFLICT — for users without github_username
export async function insertUser(user: Omit<User, 'id'>): Promise<User> {
  const embeddingStr = user.embedding
    ? `[${user.embedding.join(',')}]`
    : null;

  const sql = `
    INSERT INTO users (
      github_username, display_name, bio,
      tech_stack, domains, experience_level,
      preferred_difficulty, preferred_types, skills,
      embedding, raw_profile, tags_generated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
  `;

  const res = await pool.query(sql, [
    user.githubUsername ?? null,
    user.displayName ?? null,
    user.bio ?? null,
    user.techStack ?? [],
    user.domains ?? [],
    user.experienceLevel ?? null,
    user.preferredDifficulty ?? null,
    user.preferredTypes ?? [],
    user.skills ?? [],
    embeddingStr,
    user.rawProfile ? JSON.stringify(user.rawProfile) : null,
    user.tagsGeneratedAt ?? new Date(),
  ]);

  return rowToUser(res.rows[0]);
}

export async function getUserById(id: string): Promise<User | null> {
  const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return res.rows[0] ? rowToUser(res.rows[0]) : null;
}

export async function getUserByGithubUsername(username: string): Promise<User | null> {
  const res = await pool.query('SELECT * FROM users WHERE github_username = $1', [username]);
  return res.rows[0] ? rowToUser(res.rows[0]) : null;
}

export async function updateUserEmbedding(id: string, embedding: number[]): Promise<void> {
  const embeddingStr = `[${embedding.join(',')}]`;
  await pool.query(
    `UPDATE users SET embedding = $2, updated_at = NOW(), profile_version = profile_version + 1 WHERE id = $1`,
    [id, embeddingStr],
  );
  logger.info({ userId: id, module: 'db:users' }, 'User embedding updated');
}
