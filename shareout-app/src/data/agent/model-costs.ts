// Model prices from the Vercel AI Gateway's live catalog (GET /v1/models, public), not a
// hand-kept table: list prices change too often for one to stay right. The catalog is
// cached per isolate and in KV for a few hours. Prices are only the estimate written at
// call time; gateway calls get their real debited cost later (ai-usage-reconcile.ts).
import type { Env } from '../../types';
import { fetchWithTimeout } from '../../fetch-utils';
import { createLogger } from '../../logging';

const CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models';
const KV_KEY = 'ai:model-prices:v1';
const TTL_MS = 6 * 60 * 60_000;

/** micro-USD per token. */
interface Price { input: number; output: number }
type Prices = Record<string, Price>;

let memo: { at: number; prices: Prices } | null = null;

interface CatalogResponse { data?: Array<{ id: string; pricing?: { input?: string; output?: string } }> }

async function fetchCatalog(): Promise<Prices> {
  const res = await fetchWithTimeout(CATALOG_URL, {}, 8000);
  if (!res.ok) throw new Error(`AI Gateway catalog HTTP ${res.status}`);
  const prices: Prices = {};
  for (const m of ((await res.json()) as CatalogResponse).data ?? []) {
    const input = Number(m.pricing?.input), output = Number(m.pricing?.output);
    if (Number.isFinite(input) && Number.isFinite(output)) prices[m.id] = { input: input * 1e6, output: output * 1e6 };
  }
  if (!Object.keys(prices).length) throw new Error('AI Gateway catalog has no prices');
  return prices;
}

/** The current price list; null when the catalog can't be reached (callers mark the cost unpriced). */
export async function loadModelPrices(env: Env, now = Date.now()): Promise<Prices | null> {
  if (memo && now - memo.at < TTL_MS) return memo.prices;
  const cached = await env.PROXY_CACHE?.get(KV_KEY, 'json').catch(() => null) as { at: number; prices: Prices } | null;
  if (cached && now - cached.at < TTL_MS) return (memo = cached).prices;
  try {
    memo = { at: now, prices: await fetchCatalog() };
    await env.PROXY_CACHE?.put(KV_KEY, JSON.stringify(memo), { expirationTtl: 24 * 60 * 60 }).catch(() => {});
    return memo.prices;
  } catch (err) {
    createLogger(env, { scope: 'ai' }).warn('AI price catalog unavailable', { error: String(err) });
    return cached?.prices ?? memo?.prices ?? null;
  }
}

/** Catalog ids to try for a model as our providers name it ('claude-sonnet-5-5', 'gpt-4o', 'anthropic/claude-sonnet-5.5'). */
export function catalogIds(model: string): string[] {
  const owner = model.includes('/') ? '' : /^claude/.test(model) ? 'anthropic/' : /^(gpt|o\d)/.test(model) ? 'openai/' : /^deepseek/.test(model) ? 'deepseek/' : '';
  const base = owner + model;
  const dotted = base.replace(/-(\d+)-(\d+)$/, '-$1.$2');
  const undated = base.replace(/-\d{8}$/, '');
  return [...new Set([model, base, dotted, undated, undated.replace(/-(\d+)-(\d+)$/, '-$1.$2')])];
}

/** Estimated cost of one call in micro-USD; `priced: false` when the model isn't in the catalog. */
export async function priceCall(env: Env, model: string, inputTokens: number, outputTokens: number): Promise<{ microUsd: number; priced: boolean }> {
  const prices = await loadModelPrices(env);
  const price = prices && catalogIds(model).map((id) => prices[id]).find(Boolean);
  if (!price) {
    if (prices) createLogger(env, { scope: 'ai' }).warn('AI model has no catalog price', { model });
    return { microUsd: 0, priced: false };
  }
  return { microUsd: Math.round(inputTokens * price.input + outputTokens * price.output), priced: true };
}

/** For tests: forget the per-isolate catalog. */
export function resetModelPrices(): void { memo = null; }
