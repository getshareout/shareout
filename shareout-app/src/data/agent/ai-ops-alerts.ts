/**
 * Tells the operator (alertOps → Telegram) before AI stops working for users: a provider that
 * refuses calls for lack of credit, a daily spend over a set line, a low gateway balance. Each
 * alert is throttled so an outage or a busy day sends one message, not one per failed call.
 */
import type { Env } from '../../types';
import { alertOps } from '../../support/alert';

export type BillingProblem = 'credits' | 'budget';

/**
 * Does this provider response mean the account is out of credit or over a spend limit?
 * Deliberately narrow: a plain rate limit (429) or an auth error is not one. Matches only
 * what the providers document:
 *  - Vercel AI Gateway: 402 (no positive credit balance); 402 with type `quota_for_entity_exceeded`
 *    is a team/project/key budget reached instead. https://vercel.com/docs/ai-gateway/faq
 *  - OpenAI: error code `insufficient_quota`.
 *  - Anthropic: "Your credit balance is too low to access the Anthropic API."
 */
export function billingProblem(status: number, body: string): BillingProblem | null {
  if (status === 402) return /quota_for_entity_exceeded/.test(body) ? 'budget' : 'credits';
  if (/insufficient_quota/.test(body)) return 'credits';
  if (/credit balance is too low/i.test(body)) return 'credits';
  return null;
}

// Per-isolate fallback for an instance without RATE_LIMIT_KV: at worst one alert per isolate per window.
const seen = new Map<string, number>();

/** True when `key` was already alerted inside its window. KV when bound, else per-isolate. Not atomic: two racing callers may both alert. */
async function alreadyAlerted(env: Env, key: string): Promise<boolean> {
  const k = `ai-alert:${key}`;
  if (!env.RATE_LIMIT_KV) return (seen.get(k) ?? 0) > Date.now();
  try {
    return !!(await env.RATE_LIMIT_KV.get(k));
  } catch {
    return false;
  }
}

async function markAlerted(env: Env, key: string, ttlSec: number): Promise<void> {
  const k = `ai-alert:${key}`;
  if (env.RATE_LIMIT_KV) await env.RATE_LIMIT_KV.put(k, '1', { expirationTtl: Math.max(60, ttlSec) }).catch(() => {});
  else seen.set(k, Date.now() + ttlSec * 1000);
}

/** Send an ops alert at most once per `ttlSec` for `key`. Not marked as sent when alerting is unconfigured or fails. Never throws. */
export async function alertThrottled(env: Env, key: string, ttlSec: number, title: string, lines: string[]): Promise<boolean> {
  if (await alreadyAlerted(env, key)) return false;
  const sent = await alertOps(env, title, lines);
  if (sent) await markAlerted(env, key, ttlSec);
  return sent;
}

export const PROVIDER_ALERT_TTL_SEC = 3600;

/** A provider refused a call over credit or budget: ping the operator, once an hour per provider. Callers gate on isEnvProvider (a customer's own key is not our outage). Never throws. */
export async function reportProviderBilling(env: Env, provider: string, model: string, status: number, body: string): Promise<void> {
  const problem = billingProblem(status, body);
  if (!problem) return;
  const what = problem === 'credits' ? 'is out of credit' : 'hit a spend budget';
  await alertThrottled(env, `provider:${provider}:${problem}`, PROVIDER_ALERT_TTL_SEC, `🚨 AI provider ${provider} ${what}`, [
    `AI calls through it are failing (HTTP ${status}). Add credit or raise the limit.`,
    `Model: ${model}`,
    `Response: ${body.replace(/\s+/g, ' ').slice(0, 300)}`,
  ]);
}

const DAY_TTL_SEC = 26 * 3600;

/**
 * Hourly: add up today's (UTC) AI spend and alert once a day when it crosses
 * AI_SPEND_ALERT_USD_PER_DAY. Unset or not a positive number = off. Costs are reconciled hourly
 * from the gateway, so the figure trails real spend by up to an hour.
 */
export async function checkDailyAiSpend(env: Env, now = new Date()): Promise<{ spentUsd: number; alerted: boolean } | null> {
  const limit = Number(env.AI_SPEND_ALERT_USD_PER_DAY);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const day = now.toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(base_cost_micro_usd), 0) AS micro FROM ai_usage_events WHERE created_at >= ?`,
  ).bind(`${day}T00:00:00.000Z`).first<{ micro: number }>();
  const spentUsd = (row?.micro ?? 0) / 1e6;
  if (spentUsd < limit) return { spentUsd, alerted: false };
  const alerted = await alertThrottled(env, `spend:${day}`, DAY_TTL_SEC, '💸 AI spend over the daily line', [
    `$${spentUsd.toFixed(2)} so far today (UTC ${day}), limit $${limit.toFixed(2)} (AI_SPEND_ALERT_USD_PER_DAY).`,
    'Spend is priced hourly, so this can trail the real figure.',
  ]);
  return { spentUsd, alerted };
}

/** Gateway credit below the floor: one alert a day. */
export async function alertLowGatewayCredit(env: Env, balanceUsd: number, floorUsd: number): Promise<boolean> {
  return alertThrottled(env, 'gateway-credit-low', DAY_TTL_SEC, '🚨 AI Gateway credit is low', [
    `Balance $${balanceUsd.toFixed(2)}, alert line $${floorUsd.toFixed(2)} (AI_CREDIT_ALERT_USD). AI stops when it reaches zero.`,
  ]);
}
