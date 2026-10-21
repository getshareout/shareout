// The hourly reconcile prices metered calls: the AI Gateway's actual debited cost for
// gateway calls, the live catalog list price for the rest, and a credit-low error.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { Env } from '../../../src/types';
import { reconcileAiUsage } from '../../../src/data/ai-usage-reconcile';
import { resetModelPrices } from '../../../src/data/agent/model-costs';

const logs = vi.hoisted(() => [] as Array<[string, string, Record<string, unknown>]>);
vi.mock('../../../src/logging', () => ({
  createLogger: () => ({
    info: () => {}, debug: () => {},
    warn: (m: string, f: Record<string, unknown>) => logs.push(['warn', m, f]),
    error: (m: string, f: Record<string, unknown>) => logs.push(['error', m, f]),
  }),
}));

const env = () => ({ ...e, VERCEL_AI_GATEWAY: 'k' }) as unknown as Env;
const AGO = "strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes')";
async function row(id: string, model: string, inTok: number, outTok: number, ref: string | null) {
  await e.DB.prepare(`INSERT INTO ai_usage_events (id, kind, model, units, unit_kind, base_cost_micro_usd, input_tokens, output_tokens, cost_source, provider_ref, created_at)
    VALUES (?, 'rec_test', ?, ?, 'tokens', 0, ?, ?, 'pending', ?, ${AGO})`).bind(id, model, inTok + outTok, inTok, outTok, ref).run();
}
const get = (id: string) => e.DB.prepare('SELECT base_cost_micro_usd AS cost, cost_source, input_tokens FROM ai_usage_events WHERE id = ?').bind(id).first();

function gateway(opts: { balance: string; generations: Record<string, unknown> }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/v1/models')) return Response.json({ data: [{ id: 'openai/gpt-4o', pricing: { input: '0.0000025', output: '0.00001' } }] });
    if (url.includes('/v1/credits')) return Response.json({ balance: opts.balance, total_used: '1' });
    const id = new URL(url).searchParams.get('id')!;
    return id in opts.generations ? Response.json({ data: opts.generations[id] }) : Response.json({ error: 'Usage event not found' }, { status: 404 });
  }));
}

beforeAll(async () => { await applyMigrations(); });
beforeEach(async () => { resetModelPrices(); logs.length = 0; await e.DB.prepare("DELETE FROM ai_usage_events WHERE kind = 'rec_test'").run(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('reconcileAiUsage', () => {
  it('fills the actual gateway cost, prices direct-provider calls, and leaves late gateway usage pending', async () => {
    await row('r_gw', 'anthropic/claude-sonnet-5.5', 100, 10, 'gen_A');
    await row('r_late', 'anthropic/claude-sonnet-5.5', 100, 10, 'gen_LATE');
    await row('r_direct', 'gpt-4o', 1000, 100, null);
    await row('r_unknown', 'mystery-9', 10, 10, null);
    gateway({ balance: '150.00', generations: { gen_A: { total_cost: 0.0042, tokens_prompt: 120, tokens_completion: 10 } } });

    const res = await reconcileAiUsage(env());
    expect(res).toMatchObject({ actual: 1, repriced: 1, creditUsd: 150 });
    expect(await get('r_gw')).toEqual({ cost: 4200, cost_source: 'actual', input_tokens: 120 });
    expect(await get('r_late')).toMatchObject({ cost_source: 'pending' });
    expect(await get('r_direct')).toEqual({ cost: 2500 + 1000, cost_source: 'estimate', input_tokens: 1000 });
    expect(await get('r_unknown')).toMatchObject({ cost: 0, cost_source: 'unpriced' });
    expect(logs.filter((l) => l[0] === 'error')).toEqual([]);
  });

  it('logs an error to /admin health when gateway credit runs low', async () => {
    gateway({ balance: '3.10', generations: {} });
    await reconcileAiUsage(env());
    expect(logs).toContainEqual(['error', 'AI gateway credit low', { balanceUsd: 3.1, alertBelowUsd: 20 }]);
  });
});
