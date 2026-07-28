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
