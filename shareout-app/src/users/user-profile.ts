/**
 * Per-user agent memory — the "user.md" the agent reads/writes, plus structured
 * follows. Backed by the `user_profiles` table (migration 0090). Replaces ML
 * personalization at v1: the Brief tone and relevance read from here.
 */
import type { Env } from '../types';

export type FollowKind = 'artifact' | 'metric' | 'topic';

export interface Follow {
  kind: FollowKind;
  /** Artifact id, metric id, or topic string. */
  ref: string;
}

export interface UserProfile {
  userId: string;
  /** Free-form markdown memory (role, interests, preferences). Empty until written. */
  profileMd: string;
  follows: Follow[];
  updatedAt: string;
}

function parseFollows(raw: string | null): Follow[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((f) => f && typeof f.kind === 'string' && typeof f.ref === 'string') : [];
  } catch {
    return [];
  }
}

const sameFollow = (a: Follow, b: Follow) => a.kind === b.kind && a.ref === b.ref;

/** Current profile, or an empty default when the user has none yet. */
export async function getUserProfile(env: Env, userId: string): Promise<UserProfile> {
  const row = await env.DB.prepare(
    `SELECT user_id, profile_md, follows, updated_at FROM user_profiles WHERE user_id = ?`,
  ).bind(userId).first<{ user_id: string; profile_md: string; follows: string; updated_at: string }>();
  if (!row) return { userId, profileMd: '', follows: [], updatedAt: '' };
  return { userId: row.user_id, profileMd: row.profile_md || '', follows: parseFollows(row.follows), updatedAt: row.updated_at };
}

/** Overwrite the markdown memory, preserving follows. */
export async function setUserProfile(env: Env, userId: string, profileMd: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO user_profiles (user_id, profile_md, follows, updated_at)
    VALUES (?, ?, '[]', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(user_id) DO UPDATE SET profile_md = excluded.profile_md, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(userId, profileMd).run();
}

async function writeFollows(env: Env, userId: string, follows: Follow[]): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO user_profiles (user_id, profile_md, follows, updated_at)
    VALUES (?, '', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(user_id) DO UPDATE SET follows = excluded.follows, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(userId, JSON.stringify(follows)).run();
}

export async function getFollows(env: Env, userId: string): Promise<Follow[]> {
  return (await getUserProfile(env, userId)).follows;
}

/** Add a follow (idempotent). */
export async function addFollow(env: Env, userId: string, follow: Follow): Promise<Follow[]> {
  const follows = await getFollows(env, userId);
  if (follows.some((f) => sameFollow(f, follow))) return follows;
  const next = [...follows, follow];
  await writeFollows(env, userId, next);
  return next;
}

/** Remove a follow (idempotent). */
export async function removeFollow(env: Env, userId: string, follow: Follow): Promise<Follow[]> {
  const follows = await getFollows(env, userId);
  const next = follows.filter((f) => !sameFollow(f, follow));
  if (next.length === follows.length) return follows;
  await writeFollows(env, userId, next);
  return next;
}
