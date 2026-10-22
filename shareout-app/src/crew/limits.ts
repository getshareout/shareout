import type { Env } from '../types';

export interface CrewLimits {
  plan: string;
  max_crews_per_artifact: number;
  max_concurrent_runs: number;
  default_run_budget_micro_usd: number;
  max_iterations_cap: number;
}

// Used when the owner has no tier row or plan_crew_limits is missing a row.
const FALLBACK: CrewLimits = {
  plan: 'free',
  max_crews_per_artifact: 1,
  max_concurrent_runs: 1,
  default_run_budget_micro_usd: 250000,
  max_iterations_cap: 8,
};

/** Resolve the crew limits for an owner from users.tier → plan_crew_limits. */
export async function resolveCrewLimits(env: Env, ownerId: string): Promise<CrewLimits> {
  const user = await env.DB.prepare('SELECT tier FROM users WHERE id = ?')
    .bind(ownerId)
    .first<{ tier: string | null }>();
  const tier = user?.tier || 'free';
  const row = await env.DB.prepare('SELECT * FROM plan_crew_limits WHERE plan = ?')
    .bind(tier)
    .first<CrewLimits>();
  return row ?? FALLBACK;
}

/** Count an owner's currently-running crew runs (the per-tenant concurrency gate). */
export async function countActiveRuns(env: Env, ownerId: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM crew_runs cr
       JOIN crews c ON c.id = cr.crew_id
      WHERE c.owner_id = ? AND cr.status = 'running'`
  )
    .bind(ownerId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** Runs started by the hourly scheduled handler (cron/condition) get this at most. Cron Triggers have a 15 min wall
 *  limit and the run is mostly waiting on the model (I/O, not CPU); stale-run reaping is at 300 s, so stay well under. */
export const MAX_SCHEDULED_RUNTIME_MS = 120_000;
/** Everything else (manual SSE, event wake in waitUntil, Telegram/alert follow-ups) keeps the 25 s default:
 *  waitUntil work is cut ~30 s after the response. */
export const DEFAULT_RUNTIME_MS = 25_000;

export function effectiveMaxRuntimeMs(configured: number, triggerKind: string | null | undefined): number {
  const scheduled = triggerKind === 'cron' || triggerKind === 'condition';
  return Math.min(configured, scheduled ? MAX_SCHEDULED_RUNTIME_MS : DEFAULT_RUNTIME_MS);
}

/** True when the owner already has as many running crew runs as their plan allows. */
export async function ownerAtCapacity(env: Env, ownerId: string): Promise<boolean> {
  const limits = await resolveCrewLimits(env, ownerId);
  return (await countActiveRuns(env, ownerId)) >= limits.max_concurrent_runs;
}
