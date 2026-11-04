import type { Env } from '../types';
import { priceCall } from './agent/model-costs';

// ai_usage_events is the one AI meter: every call goes through the provider layer and lands there
// (agent_usage_events re-logs the in-page assistant and crew calls — never add it to spend). Rows
// the hourly reconcile has not priced yet (cost_source 'pending', cost 0) count at the model's list
// price, as the AI budget and invoices do, so Summary and Billing → Usage show the same total.

/** List-price cost (micro-USD) of a workspace's still-pending AI calls in [from, to), summed per user or per UTC day. */
export async function pendingAiCost(
  env: Env,
  workspaceId: string,
  from: string,
  to: string,
  by: 'user_id' | 'day',
): Promise<Map<string | null, number>> {
  const key = by === 'day' ? 'substr(created_at, 1, 10)' : 'user_id';
  const rows = (await env.DB.prepare(
    `SELECT ${key} AS k, model, SUM(input_tokens) AS tin, SUM(output_tokens) AS tout
       FROM ai_usage_events
      WHERE workspace_id = ? AND created_at >= ? AND created_at < ? AND cost_source = 'pending' AND COALESCE(base_cost_micro_usd, 0) = 0
      GROUP BY k, model`,
  ).bind(workspaceId, from, to).all<{ k: string | null; model: string; tin: number | null; tout: number | null }>()).results ?? [];
  const out = new Map<string | null, number>();
  for (const r of rows) {
    const micro = (await priceCall(env, r.model, r.tin ?? 0, r.tout ?? 0).catch(() => ({ microUsd: 0 }))).microUsd;
    out.set(r.k, (out.get(r.k) ?? 0) + micro);
  }
  return out;
}
