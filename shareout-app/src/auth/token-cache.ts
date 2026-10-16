import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { kvCacheGet } from '../kv-cache';

// Read-through KV cache for successful bearer-token validations, so token-authed
// requests (MCP, CLI, bots) skip the per-request D1 lookup.
//
// Revocation bound: a revoked token is accepted for at most TOKEN_CACHE_TTL_SEC (60 s)
// after the revoking write commits. Each entry carries `exp` = the moment its D1 read
// began + 60 s (capped at the token's own expires_at), and readers ignore an entry past
// `exp` even when KV still returns it (edge caches can serve a deleted key for a while).
// A request whose D1 read began just before the revoke can still write an entry after
// the eviction below, so 60 s is the worst case; every revoke path also deletes the key,
// so in the common case revocation takes effect on the next request.
export const TOKEN_CACHE_TTL_SEC = 60;
const TOKEN_CACHE_TTL_MS = TOKEN_CACHE_TTL_SEC * 1000;
// Don't bother caching a token that dies within this window.
const MIN_CACHE_LIFETIME_MS = 5_000;

// Failures never reach KV (an attacker spraying bad tokens would cost us writes);
// a tiny per-isolate memo absorbs retry loops of the same bad token instead.
const NEGATIVE_TTL_MS = 10_000;
const NEGATIVE_MAX = 1_000;
const negativeMemo = new Map<string, number>();

interface CachedToken {
  exp: number;
  user: AuthUser;
}

export function tokenCacheKey(tokenHash: string): string {
  return `tokauth:${tokenHash}`;
}

export function isKnownBadToken(tokenHash: string, now = Date.now()): boolean {
  const until = negativeMemo.get(tokenHash);
  if (until === undefined) return false;
  if (until > now) return true;
  negativeMemo.delete(tokenHash);
  return false;
}

export function rememberBadToken(tokenHash: string, now = Date.now()): void {
  if (negativeMemo.size >= NEGATIVE_MAX) negativeMemo.clear();
  negativeMemo.set(tokenHash, now + NEGATIVE_TTL_MS);
}

export function clearBadTokenMemo(): void {
  negativeMemo.clear();
}

export async function readCachedToken(env: Env, tokenHash: string): Promise<AuthUser | null> {
  if (!env.SLUGS) return null;
  try {
    const raw = await kvCacheGet(env.SLUGS, tokenCacheKey(tokenHash));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedToken;
    if (typeof entry?.exp !== 'number' || entry.exp <= Date.now() || !entry.user?.id) return null;
    return entry.user;
  } catch {
    return null;
  }
}

/** `readStartedAt` must be taken before the D1 read: it anchors the revocation bound. */
export async function writeCachedToken(
  env: Env,
  tokenHash: string,
  user: AuthUser,
  tokenExpiresAt: string | null,
  readStartedAt: number,
): Promise<void> {
  if (!env.SLUGS) return;
  let exp = readStartedAt + TOKEN_CACHE_TTL_MS;
  if (tokenExpiresAt) {
    const tokenExp = Date.parse(tokenExpiresAt);
    if (Number.isFinite(tokenExp)) exp = Math.min(exp, tokenExp);
  }
  if (exp - Date.now() < MIN_CACHE_LIFETIME_MS) return;
  const entry: CachedToken = { exp, user };
  try {
    // KV's floor is 60 s; the embedded `exp` is what actually bounds the entry.
    await env.SLUGS.put(tokenCacheKey(tokenHash), JSON.stringify(entry), { expirationTtl: TOKEN_CACHE_TTL_SEC });
  } catch { /* best-effort */ }
}

export async function evictCachedTokens(env: Env, hashes: Iterable<string | null | undefined>): Promise<void> {
  if (!env.SLUGS) return;
  const kv = env.SLUGS;
  const unique = [...new Set([...hashes].filter((h): h is string => typeof h === 'string' && h.length > 0))];
  await Promise.all(unique.map(async (h) => {
    try { await kv.delete(tokenCacheKey(h)); } catch { /* best-effort; exp still bounds it */ }
  }));
}

/** Evict the hashes a `... RETURNING token_hash` statement handed back. */
export async function evictReturnedTokens(env: Env, result: { results?: unknown[] } | null | undefined): Promise<void> {
  const rows = (result?.results ?? []) as Array<{ token_hash?: string | null }>;
  if (rows.length) await evictCachedTokens(env, rows.map((r) => r?.token_hash));
}

/** Every token that resolves to this user: personal, Agent principal, or external subject. */
export async function tokenHashesForUser(env: Env, userId: string): Promise<string[]> {
  try {
    const res = await env.DB.prepare(
      'SELECT token_hash FROM tokens WHERE user_id = ? OR principal_id = ? OR subject_external_user_id = ?'
    ).bind(userId, userId, userId).all<{ token_hash: string }>();
    return (res?.results ?? []).map((r) => r.token_hash);
  } catch {
    return [];
  }
}

export async function evictUserTokens(env: Env, userId: string): Promise<void> {
  if (!env.SLUGS) return;
  await evictCachedTokens(env, await tokenHashesForUser(env, userId));
}
