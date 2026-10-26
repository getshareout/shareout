// Hourly per-user cap on verify runs. Same rate_limits rows as checkPresentLimit /
// incrementPresentLimit (src/api-auth.ts): a distinct action with an hour-bucketed
// window_start, so no schema change. Each run holds a Browser Rendering session for
// ~10 s, which is what this caps.
import type { Env } from '../types';
import { isSuperAdminEmail } from '../superadmin/recipients';

const VERIFY_LIMIT_ACTION = 'verify';
const DEFAULT_RUNS_PER_HOUR = 30;

/** Runs per user per UTC hour: VERIFY_RUNS_PER_HOUR when it is a positive integer, else 30. */
export function verifyRunsPerHour(env: Env): number {
  const n = Number.parseInt((env.VERIFY_RUNS_PER_HOUR || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RUNS_PER_HOUR;
}

function hourWindow(): { key: string; reset: number } {
  const windowStart = new Date();
  windowStart.setUTCMinutes(0, 0, 0);
  return { key: windowStart.toISOString(), reset: Math.floor(windowStart.getTime() / 1000) + 3600 };
}

export async function checkVerifyLimit(
  env: Env,
  userId: string,
  email?: string | null,
): Promise<{ allowed: boolean; limit: number; remaining: number; reset: number }> {
  const { key, reset } = hourWindow();
  const limit = verifyRunsPerHour(env);
  if (isSuperAdminEmail(email, env)) return { allowed: true, limit, remaining: limit, reset };
  const row = await env.DB.prepare(
    "SELECT count FROM rate_limits WHERE principal_type = 'user' AND principal_id = ? AND action = ? AND window_start = ?"
  ).bind(userId, VERIFY_LIMIT_ACTION, key).first<{ count: number }>();
  const used = row?.count || 0;
  return { allowed: used < limit, limit, remaining: Math.max(0, limit - used), reset };
}

export async function incrementVerifyLimit(env: Env, userId: string, email?: string | null): Promise<void> {
  if (isSuperAdminEmail(email, env)) return;
  await env.DB.prepare(`
    INSERT INTO rate_limits (principal_type, principal_id, action, window_start, count)
    VALUES ('user', ?, ?, ?, 1)
    ON CONFLICT(principal_type, principal_id, action, window_start) DO UPDATE SET count = count + 1
  `).bind(userId, VERIFY_LIMIT_ACTION, hourWindow().key).run();
}
