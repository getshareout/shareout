import type { Env } from '../types';
import {
  createSessionToken,
  verifySessionToken,
  extractTokenFromCookie,
} from '../token';
import { COOKIE_NAME, SESSION_MAX_AGE } from './constants';
import { buildSessionCookie } from './cookies';
import { getPlatformHostname } from '../config/origins';

/**
 * Resolve the session `Max-Age` for a user. Takes the strictest
 * `session_max_days` across all workspaces the user belongs to,
 * capped at the 30-day default. Fails open on DB errors.
 */
export async function resolveSessionMaxAge(env: Env, userId: string): Promise<number> {
  try {
    const row = await env.DB.prepare(
      `SELECT MIN(w.session_max_days) AS days
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
        WHERE wm.user_id = ? AND w.session_max_days IS NOT NULL AND w.session_max_days > 0`
    ).bind(userId).first<{ days: number | null }>();
    if (row?.days && row.days > 0) {
      return Math.min(SESSION_MAX_AGE, row.days * 86_400);
    }
  } catch {
    /* fall through to default */
  }
  return SESSION_MAX_AGE;
}

// The disable flag changes only on a super-admin lockout (revokeUserAccess),
// which invalidates the key below. Cache it in SLUGS (the same KV used by
// art:/deploy:/wsrole:) so the otherwise-universal per-request read on every
// authenticated /app + API hit becomes a KV hit. Short TTL bounds the staleness
// window for the rare case where invalidation is missed.
const USER_DISABLED_TTL = 60;
const USER_DISABLED_FLAG = '1';
const USER_ENABLED_FLAG = '0';

function userDisabledCacheKey(userId: string): string {
  return `userdisabled:${userId}`;
}

export async function invalidateUserDisabled(env: Env, userId: string): Promise<void> {
  if (!env.SLUGS) return;
  try { await env.SLUGS.delete(userDisabledCacheKey(userId)); } catch { /* best-effort */ }
}

/** Read the logged-in user from the zone-wide session cookie, if any. */
export async function getSessionUser(request: Request, env: Env): Promise<{ id: string; email: string } | null> {
  const cookie = request.headers.get('Cookie');
  const token = extractTokenFromCookie(cookie, new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!token) return null;

  const payload = await verifySessionToken(token, env);
  if (!payload) return null;

  // Honor the super-admin disable flag: a disabled account's session is dead even
  // though the signed token is still cryptographically valid. Only logged-in
  // requests reach this point, so the lookup never touches anonymous traffic.
  // Read-through KV cache; fail open on any error — a transient outage shouldn't
  // sign everyone out.
  const cacheKey = userDisabledCacheKey(payload.userId);
  if (env.SLUGS) {
    try {
      const cached = await env.SLUGS.get(cacheKey);
      if (cached === USER_DISABLED_FLAG) return null;
      if (cached === USER_ENABLED_FLAG) return { id: payload.userId, email: payload.email };
    } catch { /* fall through to D1 */ }
  }

  try {
    const row = await env.DB.prepare(
      'SELECT disabled FROM users WHERE id = ?'
    ).bind(payload.userId).first<{ disabled: number }>();
    const disabled = !!row?.disabled;
    if (env.SLUGS) {
      try {
        await env.SLUGS.put(cacheKey, disabled ? USER_DISABLED_FLAG : USER_ENABLED_FLAG, { expirationTtl: USER_DISABLED_TTL });
      } catch { /* best-effort */ }
    }
    if (disabled) return null;
  } catch {
    /* fall through */
  }

  return { id: payload.userId, email: payload.email };
}

/** Mint a logged-in session cookie for a user (used by email-OTP sign-in). */
export async function createSessionCookieForUser(
  env: Env,
  url: URL,
  userId: string,
  email: string
): Promise<string> {
  const maxAge = await resolveSessionMaxAge(env, userId);
  const token = await createSessionToken(userId, email, env, maxAge);
  return buildSessionCookie(url, token, maxAge, getPlatformHostname(env));
}
