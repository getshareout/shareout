import type { Env } from '../types';
import { createLogger } from '../logging';

// The price a workspace pays for AI: metered cost (ai_usage_events / agent_usage_events /
// crew_runs, at provider list price) × a markup in basis points (migrations/0035). The
// workspace only ever sees the result; platform admins see cost, price and margin.
// Resolution: workspace_llm_config.ai_markup_bps → instance_ai_settings.default_markup_bps →
// AT_COST_BPS. Infra metrics (storage, serving, email, browser) are not resold.

export const AT_COST_BPS = 10_000;
export const MAX_MARKUP_BPS = 100_000; // 10×

export interface Markup {
  /** Effective basis points (10000 = at cost). */
  bps: number;
  /** The workspace's own override, or null. */
  workspaceBps: number | null;
  /** The instance default, or null (= at cost). */
  instanceBps: number | null;
}

const valid = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= AT_COST_BPS && n <= MAX_MARKUP_BPS;

/** The markup in force for a workspace. Never throws: a failed read logs and prices at cost rather than break the page. */
export async function workspaceMarkup(env: Env, workspaceId: string | null | undefined): Promise<Markup> {
  try {
    const row = await env.DB.prepare(
      `SELECT (SELECT default_markup_bps FROM instance_ai_settings WHERE id = 1) AS instance_bps,
              (SELECT ai_markup_bps FROM workspace_llm_config WHERE workspace_id = ?) AS workspace_bps`,
    ).bind(workspaceId ?? '').first<{ instance_bps: number | null; workspace_bps: number | null }>();
    const workspaceBps = valid(row?.workspace_bps) ? row!.workspace_bps : null;
    const instanceBps = valid(row?.instance_bps) ? row!.instance_bps : null;
    return { bps: workspaceBps ?? instanceBps ?? AT_COST_BPS, workspaceBps, instanceBps };
  } catch (err) {
    createLogger(env, { scope: 'ai-markup' }).warn('AI markup unreadable; pricing at cost', { workspace_id: workspaceId ?? null, error: String(err) });
    return { bps: AT_COST_BPS, workspaceBps: null, instanceBps: null };
  }
}

/** Cost → the price the workspace pays, in the same unit (micro-USD in, micro-USD out). */
export const resell = (costMicro: number, bps: number): number => Math.round(((Number(costMicro) || 0) * bps) / AT_COST_BPS);

/** 1.5 → 15000. Null for anything that is not a multiplier between 1× and 10×. */
export function bpsFromMultiplier(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const bps = Math.round(v * AT_COST_BPS);
  return valid(bps) ? bps : null;
}

export const multiplier = (bps: number | null): number | null => (bps == null ? null : bps / AT_COST_BPS);

/** Crew run rows as the workspace sees them: cost_micro_usd at its price. */
export function priceRuns<T extends { cost_micro_usd?: unknown }>(runs: T[], bps: number): T[] {
  return runs.map((r) => (typeof r.cost_micro_usd === 'number' ? { ...r, cost_micro_usd: resell(r.cost_micro_usd, bps) } : r));
}
