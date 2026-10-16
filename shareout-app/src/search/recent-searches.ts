import type { Env } from '../types';
import { normalize } from './quick-search';

/**
 * Recent palette searches, per user and scope (workspace id, or '' for personal / all
 * pages). Every read and write is keyed by the signed-in user's id, so one person's
 * queries never reach another, and by scope, so a workspace's queries stay in it.
 */

export const RECENT_SEARCHES_CAP = 20;
export const RECENT_QUERY_MAX = 200;
const SCOPE_MAX = 80;

export interface RecentSearch { q: string; at: string }

export function recentScopeKey(workspace: string | null | undefined): string {
  const s = (workspace || '').trim();
  return s.length <= SCOPE_MAX ? s : s.slice(0, SCOPE_MAX);
}

/** Collapsed whitespace, capped; '' when there is nothing worth keeping. */
export function cleanQuery(q: unknown): string {
  return typeof q === 'string' ? q.replace(/\s+/g, ' ').trim().slice(0, RECENT_QUERY_MAX) : '';
}

export async function listRecentSearches(env: Env, userId: string, scope: string): Promise<RecentSearch[]> {
  const rows = (await env.DB.prepare(
    `SELECT query, searched_at FROM user_recent_searches WHERE user_id = ? AND scope_key = ? ORDER BY searched_at DESC LIMIT ?`,
  ).bind(userId, scope, RECENT_SEARCHES_CAP).all<{ query: string; searched_at: string }>()).results || [];
  return rows.map((r) => ({ q: r.query, at: r.searched_at }));
}

/** Records `q` as the newest search (a repeat moves to the top) and trims to the cap. */
export async function recordRecentSearch(env: Env, userId: string, scope: string, q: string): Promise<RecentSearch[]> {
  const query = cleanQuery(q);
  const key = normalize(query);
  if (!key) return listRecentSearches(env, userId, scope);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_recent_searches (user_id, scope_key, query_key, query, searched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, scope_key, query_key) DO UPDATE SET query = excluded.query, searched_at = excluded.searched_at`,
    ).bind(userId, scope, key, query, new Date().toISOString()),
    env.DB.prepare(
      `DELETE FROM user_recent_searches WHERE user_id = ? AND scope_key = ? AND query_key NOT IN
         (SELECT query_key FROM user_recent_searches WHERE user_id = ? AND scope_key = ? ORDER BY searched_at DESC LIMIT ?)`,
    ).bind(userId, scope, userId, scope, RECENT_SEARCHES_CAP),
  ]);
  return listRecentSearches(env, userId, scope);
}

/** Removes one query, or every query in the scope when `q` is null. */
export async function removeRecentSearch(env: Env, userId: string, scope: string, q: string | null): Promise<RecentSearch[]> {
  if (q == null) {
    await env.DB.prepare(`DELETE FROM user_recent_searches WHERE user_id = ? AND scope_key = ?`).bind(userId, scope).run();
    return [];
  }
  await env.DB.prepare(`DELETE FROM user_recent_searches WHERE user_id = ? AND scope_key = ? AND query_key = ?`)
    .bind(userId, scope, normalize(cleanQuery(q))).run();
  return listRecentSearches(env, userId, scope);
}
