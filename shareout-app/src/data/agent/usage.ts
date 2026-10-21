import type { Env } from '../../types';
import type { AgentMode } from './types';

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = prefix + '_';
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export async function recordUsage(
  env: Env,
  artifactId: string,
  mode: AgentMode,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM

  await env.DB.prepare(`
    INSERT INTO agent_usage (id, artifact_id, mode, period, input_tokens, output_tokens, request_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(artifact_id, mode, period) DO UPDATE SET
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      request_count = request_count + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(
    generateId('usg'),
    artifactId,
    mode,
    period,
    inputTokens,
    outputTokens
  ).run();
}

export async function recordError(
  env: Env,
  artifactId: string,
  mode: AgentMode
): Promise<void> {
  const period = new Date().toISOString().slice(0, 7);

  await env.DB.prepare(`
    INSERT INTO agent_usage (id, artifact_id, mode, period, error_count, updated_at)
    VALUES (?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(artifact_id, mode, period) DO UPDATE SET
      error_count = error_count + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(generateId('usg'), artifactId, mode, period).run();
}

export async function getUsage(
  env: Env,
  artifactId: string,
  period?: string
): Promise<{
  visitor: { input_tokens: number; output_tokens: number; request_count: number; error_count: number } | null;
  admin: { input_tokens: number; output_tokens: number; request_count: number; error_count: number } | null;
  pilot: { input_tokens: number; output_tokens: number; request_count: number; error_count: number } | null;
}> {
  const targetPeriod = period || new Date().toISOString().slice(0, 7);

  const results = await env.DB.prepare(`
    SELECT mode, input_tokens, output_tokens, request_count, error_count
    FROM agent_usage
    WHERE artifact_id = ? AND period = ?
  `).bind(artifactId, targetPeriod).all();

  const usage: {
    visitor: { input_tokens: number; output_tokens: number; request_count: number; error_count: number } | null;
    admin: { input_tokens: number; output_tokens: number; request_count: number; error_count: number } | null;
    pilot: { input_tokens: number; output_tokens: number; request_count: number; error_count: number } | null;
  } = { visitor: null, admin: null, pilot: null };

  for (const row of results.results as Array<{
    mode: string;
    input_tokens: number;
    output_tokens: number;
    request_count: number;
    error_count: number;
  }>) {
    if (row.mode === 'visitor' || row.mode === 'admin' || row.mode === 'pilot') {
      usage[row.mode] = {
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        request_count: row.request_count,
        error_count: row.error_count,
      };
    }
  }

  return usage;
}

// Visitor-agent ceilings. The old per-artifact table carried these as columns, but
// nothing ever wrote them — every artifact ran on the defaults — so they are
// constants and the counters are ordinary `rate_limits` rows.
export const AGENT_REQUESTS_PER_MINUTE = 10;
export const AGENT_TOKENS_PER_DAY = 100000;

export async function checkRateLimit(
  env: Env,
  artifactId: string,
  estimatedTokens: number = 0,
  held: { requests: number; tokens: number } = { requests: 0, tokens: 0 }
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const dayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD

  // A window that has rolled over simply has no row yet, so both counters read 0.
  const { results } = await env.DB.prepare(`
    SELECT action, count FROM rate_limits
     WHERE principal_type = 'artifact' AND principal_id = ?
       AND ((action = 'agent_requests' AND window_start = ?)
         OR (action = 'agent_tokens' AND window_start = ?))
  `).bind(artifactId, minuteKey, dayKey).all<{ action: string; count: number }>();

  const counts = results ?? [];
  const minuteCount = (counts.find(r => r.action === 'agent_requests')?.count ?? 0) - held.requests;
  const dayTokens = (counts.find(r => r.action === 'agent_tokens')?.count ?? 0) - held.tokens;

  if (minuteCount >= AGENT_REQUESTS_PER_MINUTE) {
    const nextMinute = new Date(now);
    nextMinute.setSeconds(60, 0);
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((nextMinute.getTime() - now.getTime()) / 1000),
    };
  }

  if (dayTokens + estimatedTokens > AGENT_TOKENS_PER_DAY) {
    const nextDay = new Date(now);
    nextDay.setUTCHours(24, 0, 0, 0);
    return {
      allowed: false,
      remaining: Math.max(0, AGENT_TOKENS_PER_DAY - dayTokens),
      retryAfter: Math.ceil((nextDay.getTime() - now.getTime()) / 1000),
    };
  }

  return {
    allowed: true,
    remaining: AGENT_REQUESTS_PER_MINUTE - minuteCount - 1,
  };
}

export async function incrementRateLimit(
  env: Env,
  artifactId: string,
  tokensUsed: number,
  requests = 1
): Promise<void> {
  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16);
  const dayKey = now.toISOString().slice(0, 10);

  await env.DB.batch([
    ...(requests ? [env.DB.prepare(`
      INSERT INTO rate_limits (principal_type, principal_id, action, window_start, count)
      VALUES ('artifact', ?1, 'agent_requests', ?2, MAX(0, ?3))
      ON CONFLICT(principal_type, principal_id, action, window_start) DO UPDATE SET count = MAX(0, count + ?3)
    `).bind(artifactId, minuteKey, requests)] : []),
    env.DB.prepare(`
      INSERT INTO rate_limits (principal_type, principal_id, action, window_start, count)
      VALUES ('artifact', ?1, 'agent_tokens', ?2, MAX(0, ?3))
      ON CONFLICT(principal_type, principal_id, action, window_start) DO UPDATE SET count = MAX(0, count + ?3)
    `).bind(artifactId, dayKey, tokensUsed),
  ]);
}

/** Charges the request and its worst-case tokens up front, then checks the counters including that hold, so parallel requests cannot all pass a stale read. A refused request gives the hold back. */
export async function reserveRateLimit(
  env: Env,
  artifactId: string,
  reservedTokens: number
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  await incrementRateLimit(env, artifactId, reservedTokens);
  const result = await checkRateLimit(env, artifactId, 0, { requests: 1, tokens: reservedTokens });
  if (!result.allowed) await incrementRateLimit(env, artifactId, -reservedTokens, -1);
  return result;
}
