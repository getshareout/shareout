import type { Env } from '../types';
import { createLogger } from '../logging';
import { priceCall } from './agent/model-costs';

// The workspace's monthly AI budget: one number (workspace_llm_config.monthly_budget_micro_usd) against one
// sum (every ai_usage_events row of the workspace since the start of the UTC month). The provider layer
// (data/agent/anthropic.ts, crew/provider.ts, pilot) refuses new calls once it is reached.
//
// Not gated, on purpose: embeddings and search (Workers AI, ~$0.07 per million tokens, and the corpus is
// useless without them), Whisper (cents per hour of audio), publish moderation (a safety check that has to
// run), and personal calls with no workspace. They still land in ai_usage_events and count toward the sum.
//
// Rows are written `pending` with cost 0 until the hourly reconcile prices them, so the sum adds a list-price
// estimate for pending rows; otherwise the last hour of spend would be invisible to the ceiling.

export const BUDGET_NEAR_PCT = 80;
export const BUDGET_CODE = 'workspace_budget';
const CACHE_MS = 60_000;

export type BudgetLevel = 'none' | 'ok' | 'near' | 'reached';

export interface BudgetState {
  budgetMicro: number | null;
  spentMicro: number;
  /** Whole percent of the budget used (can pass 100); null when no budget is set. */
  pct: number | null;
  state: BudgetLevel;
  resetsAt: string;
  byKind: Record<string, number>;
}

export class WorkspaceBudgetError extends Error {
  readonly code = BUDGET_CODE;
  constructor(readonly resetsAt: string) {
    super('This workspace reached its monthly AI budget');
  }
}

export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const nextMonthStartIso = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

const cache = new Map<string, { at: number; state: BudgetState }>();
const warned = new Set<string>();

/** Forget cached spend/budget (after a budget change, and in tests). */
export function resetBudgetCache(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId);
  else { cache.clear(); warned.clear(); }
}

async function readSpend(env: Env, workspaceId: string, since: string): Promise<{ total: number; byKind: Record<string, number> }> {
  const rows = (await env.DB.prepare(
    `SELECT kind, model, cost_source, SUM(base_cost_micro_usd) AS cost, SUM(input_tokens) AS tin, SUM(output_tokens) AS tout
       FROM ai_usage_events WHERE workspace_id = ? AND created_at >= ?
      GROUP BY kind, model, cost_source`,
  ).bind(workspaceId, since).all<{ kind: string; model: string; cost_source: string | null; cost: number | null; tin: number | null; tout: number | null }>()).results ?? [];
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    let micro = r.cost ?? 0;
    if (r.cost_source === 'pending' && micro === 0) {
      micro = (await priceCall(env, r.model, r.tin ?? 0, r.tout ?? 0).catch(() => ({ microUsd: 0 }))).microUsd;
    }
    byKind[r.kind] = (byKind[r.kind] ?? 0) + micro;
    total += micro;
  }
  return { total, byKind };
}

async function warnOnce(env: Env, workspaceId: string, level: 'near' | 'reached', s: BudgetState): Promise<void> {
  const key = `ai-budget-warn:${workspaceId}:${monthStart().toISOString().slice(0, 7)}:${level}`;
  if (warned.has(key)) return;
  warned.add(key);
  try {
    if (env.RATE_LIMIT_KV) {
      if (await env.RATE_LIMIT_KV.get(key)) return;
      await env.RATE_LIMIT_KV.put(key, '1', { expirationTtl: 40 * 24 * 3600 });
    }
    const log = createLogger(env, { scope: 'ai-budget' });
    const fields = { workspace_id: workspaceId, spent_usd: s.spentMicro / 1e6, budget_usd: (s.budgetMicro ?? 0) / 1e6, pct: s.pct };
    if (level === 'reached') log.error('Workspace reached its monthly AI budget', fields);
    else log.warn('Workspace passed 80% of its monthly AI budget', fields);
  } catch { /* a warning must never block a call */ }
}

/** This month's budget, spend (cached ~60 s per isolate) and spend by kind for a workspace. */
export async function budgetState(env: Env, workspaceId: string, opts: { fresh?: boolean } = {}): Promise<BudgetState> {
  const hit = cache.get(workspaceId);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.state;
  const cfg = await env.DB.prepare('SELECT monthly_budget_micro_usd AS b FROM workspace_llm_config WHERE workspace_id = ?')
    .bind(workspaceId).first<{ b: number | null }>();
  const { total, byKind } = await readSpend(env, workspaceId, monthStart().toISOString());
  const budgetMicro = cfg?.b ?? null;
  const pct = budgetMicro ? Math.floor((total / budgetMicro) * 100) : null;
  const state: BudgetState = {
    budgetMicro, spentMicro: total, pct, byKind, resetsAt: nextMonthStartIso(),
    state: budgetMicro == null ? 'none' : total >= budgetMicro ? 'reached' : pct! >= BUDGET_NEAR_PCT ? 'near' : 'ok',
  };
  cache.set(workspaceId, { at: Date.now(), state });
  if (state.state === 'reached') await warnOnce(env, workspaceId, 'reached', state);
  if (state.state === 'reached' || state.state === 'near') await warnOnce(env, workspaceId, 'near', state);
  return state;
}

/** True when the workspace set a monthly AI budget and this month's metered spend has reached it. */
export async function workspaceOverBudget(env: Env, workspaceId: string): Promise<boolean> {
  return (await budgetState(env, workspaceId)).state === 'reached';
}

/** The error to refuse a call with, or null. Personal calls (no workspace) are never blocked. */
export async function workspaceBudgetBlock(env: Env, workspaceId: string | null | undefined): Promise<WorkspaceBudgetError | null> {
  if (!workspaceId) return null;
  const s = await budgetState(env, workspaceId).catch(() => null);
  return s?.state === 'reached' ? new WorkspaceBudgetError(s.resetsAt) : null;
}

export const isBudgetError = (e: unknown): e is WorkspaceBudgetError => e instanceof WorkspaceBudgetError;
