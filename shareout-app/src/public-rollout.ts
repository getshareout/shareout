// Runtime kill switch + auto-rollback for the public-artifacts rollout.
//
// The gradual rollout (visibility-config) is env-var driven, which needs a deploy
// to change. This adds a KV-backed override that flips instantly (no deploy) AND
// can be tripped automatically when abuse spikes. When killed, NEW open-visibility
// publishes are denied for rollout users (showcase workspaces are left alone — they
// are curated). It does NOT retroactively hide already-public artifacts; that's the
// per-artifact takedown path (Workstream D).

import type { Env } from './types';
import { notifyAdmin } from './observability/alerts';

const KILL_KEY = 'public_rollout_killed';

function kv(env: Env): KVNamespace | undefined {
  return env.SLUGS;
}

/** True when the rollout has been killed (manually or auto-tripped). */
export async function isPublicRolloutKilled(env: Env): Promise<boolean> {
  const store = kv(env);
  if (!store) return false;
  try {
    return (await store.get(KILL_KEY)) !== null;
  } catch {
    return false;
  }
}

export async function setPublicRolloutKilled(env: Env, killed: boolean, reason?: string): Promise<void> {
  const store = kv(env);
  if (!store) return;
  try {
    if (killed) await store.put(KILL_KEY, reason || 'killed');
    else await store.delete(KILL_KEY);
  } catch {
    // best-effort
  }
}

function autoKillThreshold(env: Env): number {
  const n = parseInt(env.PUBLIC_ABUSE_AUTOKILL_PER_DAY || '50', 10);
  return Number.isNaN(n) || n <= 0 ? 50 : n;
}

/**
 * Auto-rollback: if abuse reports in the last 24h exceed the threshold, trip the
 * kill switch and alert. Idempotent — does nothing if already killed. Run from the
 * scheduled handler.
 */
export async function checkPublicAutoRollback(env: Env): Promise<void> {
  if (await isPublicRolloutKilled(env)) return;
  const threshold = autoKillThreshold(env);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM abuse_reports WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-1 day')`
  ).bind().first<{ n: number }>().catch(() => null);
  const count = row?.n ?? 0;
  if (count >= threshold) {
    await setPublicRolloutKilled(env, true, `auto: ${count} abuse reports in 24h`);
    await notifyAdmin(
      env,
      `🛑 Public-artifacts rollout AUTO-KILLED: ${count} abuse reports in 24h (threshold ${threshold}). New public publishes are blocked. Investigate, then clear the kill switch.`
    ).catch(() => {});
  }
}
