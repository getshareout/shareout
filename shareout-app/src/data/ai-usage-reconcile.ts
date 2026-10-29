// Hourly: price the metered calls in ai_usage_events — what the AI Gateway actually debited
// for gateway calls, the live catalog list price for the rest (and for gateway calls whose
// usage never showed up) — and warn before the gateway credit runs out
// (2026-10-21 both providers ran dry and nothing said so until features failed).
import type { Env } from '../types';
import { fetchWithTimeout } from '../fetch-utils';
import { createLogger } from '../logging';
import { priceCall } from './agent/model-costs';
import { alertLowGatewayCredit } from './agent/ai-ops-alerts';

const GATEWAY = 'https://ai-gateway.vercel.sh/v1';
const BATCH = 300;
const CONCURRENCY = 8;
/** Below this many USD of gateway credit, /admin health shows an error. Override: AI_CREDIT_ALERT_USD. */
const DEFAULT_CREDIT_ALERT_USD = 20;

interface Generation { total_cost?: number }

async function generation(env: Env, id: string): Promise<Generation | null> {
  const res = await fetchWithTimeout(`${GATEWAY}/generation?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${env.VERCEL_AI_GATEWAY}` },
  }, 8000);
  // Usage events land a few seconds late ("Usage event not found"): try again next hour.
  if (!res.ok) return null;
  return ((await res.json()) as { data?: Generation }).data ?? null;
}

async function pool<T>(items: T[], fn: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t).catch(() => {});
  }));
}

export async function reconcileAiUsage(env: Env): Promise<{ actual: number; repriced: number; creditUsd: number | null }> {
  const log = createLogger(env, { scope: 'ai' });
  let actual = 0, repriced = 0, creditUsd: number | null = null;

  if (env.VERCEL_AI_GATEWAY) {
    const rows = (await env.DB.prepare(`
      SELECT id, provider_ref FROM ai_usage_events
       WHERE provider_ref IS NOT NULL AND cost_source = 'pending'
         AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 minutes')
         AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')
       ORDER BY created_at LIMIT ?`).bind(BATCH).all<{ id: string; provider_ref: string }>()).results ?? [];
    await pool(rows, async (r) => {
      const g = await generation(env, r.provider_ref);
      if (!g || typeof g.total_cost !== 'number') return;
      // Cost only: the gateway's tokens_prompt leaves out prompt-cache reads (a 3,388-token
      // call came back as 4), so the tokens we streamed stay the record.
      await env.DB.prepare(`UPDATE ai_usage_events SET base_cost_micro_usd = ?, cost_source = 'actual' WHERE id = ?`)
        .bind(Math.round(g.total_cost * 1e6), r.id).run();
      actual++;
    });

    try {
      const res = await fetchWithTimeout(`${GATEWAY}/credits`, { headers: { Authorization: `Bearer ${env.VERCEL_AI_GATEWAY}` } }, 8000);
      if (res.ok) {
        creditUsd = Number(((await res.json()) as { balance?: string }).balance);
        const floor = Number(env.AI_CREDIT_ALERT_USD) || DEFAULT_CREDIT_ALERT_USD;
        if (Number.isFinite(creditUsd) && creditUsd < floor) {
          log.error('AI gateway credit low', { balanceUsd: creditUsd, alertBelowUsd: floor });
          await alertLowGatewayCredit(env, creditUsd, floor);
        }
      }
    } catch (err) {
      log.warn('AI gateway credit check failed', { error: String(err) });
    }
  }

  // No cost lookup (direct providers), a gateway call whose usage never arrived (a day on),
  // or a model the catalog didn't price yet: list price.
  const unpriced = (await env.DB.prepare(`
    SELECT id, model, input_tokens, output_tokens FROM ai_usage_events
     WHERE created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')
       AND (cost_source = 'unpriced'
         OR (cost_source = 'pending' AND (provider_ref IS NULL OR created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))))
     ORDER BY created_at LIMIT ?`).bind(BATCH).all<{ id: string; model: string; input_tokens: number | null; output_tokens: number | null }>()).results ?? [];
  for (const r of unpriced) {
    const p = await priceCall(env, r.model, r.input_tokens ?? 0, r.output_tokens ?? 0);
    await env.DB.prepare(`UPDATE ai_usage_events SET base_cost_micro_usd = ?, cost_source = ? WHERE id = ? AND cost_source IN ('pending', 'unpriced')`)
      .bind(p.microUsd, p.priced ? 'estimate' : 'unpriced', r.id).run();
    if (p.priced) repriced++;
  }

  return { actual, repriced, creditUsd };
}
