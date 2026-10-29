// @vitest-environment node
// Out-of-credit provider errors and the daily spend line reach the operator once, not per call.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const alertOps = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../src/support/alert', () => ({ alertOps }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { alertLowGatewayCredit, alertThrottled, billingProblem, checkDailyAiSpend, reportProviderBilling } from '../../../src/data/agent/ai-ops-alerts';
import type { Env } from '../../../src/types';

function fakeKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } } as unknown as KVNamespace;
}
const newEnv = (extra: Partial<Env> = {}) => ({ ...e, RATE_LIMIT_KV: fakeKv(), ...extra }) as Env;

beforeAll(applyMigrations);
beforeEach(() => alertOps.mockClear());

describe('billingProblem', () => {
  it.each([
    [402, '{"error":{"message":"Insufficient funds"}}', 'credits'],
    [402, '{"error":{"type":"quota_for_entity_exceeded"}}', 'budget'],
    [429, '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}', 'credits'],
    [400, '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}', 'credits'],
  ])('flags %i %s', (status, body, want) => expect(billingProblem(status, body)).toBe(want));

  it.each([
    [429, '{"error":{"message":"Rate limit reached for requests"}}'],
    [401, '{"error":{"message":"Invalid API key"}}'],
    [500, 'upstream error'],
    [403, '{"error":{"message":"model not allowed"}}'],
    [200, ''],
  ])('ignores %i %s', (status, body) => expect(billingProblem(status, body)).toBeNull());
});

describe('throttle', () => {
  it('alerts once per provider, then stays quiet; another provider still alerts', async () => {
    const env = newEnv();
    await reportProviderBilling(env, 'vercel-gateway', 'm', 402, 'no credit');
    await reportProviderBilling(env, 'vercel-gateway', 'm', 402, 'no credit');
    expect(alertOps).toHaveBeenCalledTimes(1);
    expect(alertOps.mock.calls[0][1]).toContain('vercel-gateway');
    await reportProviderBilling(env, 'openai', 'm', 429, '{"code":"insufficient_quota"}');
    expect(alertOps).toHaveBeenCalledTimes(2);
  });

  it('does not alert for an ordinary rate limit', async () => {
    await reportProviderBilling(newEnv(), 'openai', 'm', 429, 'Rate limit reached');
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('does not use up the window when alerting is not configured', async () => {
    const env = newEnv();
    alertOps.mockResolvedValueOnce(false);
    expect(await alertThrottled(env, 'k', 3600, 't', [])).toBe(false);
    expect(await alertThrottled(env, 'k', 3600, 't', [])).toBe(true);
  });

  it('works without KV (per isolate)', async () => {
    const env = { ...e, RATE_LIMIT_KV: undefined } as Env;
    expect(await alertThrottled(env, 'nokv', 3600, 't', [])).toBe(true);
    expect(await alertThrottled(env, 'nokv', 3600, 't', [])).toBe(false);
  });

  it('low gateway credit alerts once a day', async () => {
    const env = newEnv();
    await alertLowGatewayCredit(env, 3.5, 20);
    await alertLowGatewayCredit(env, 3.4, 20);
    expect(alertOps).toHaveBeenCalledTimes(1);
  });
});

describe('daily spend line', () => {
  const now = new Date('2026-10-29T15:00:00Z');
  const spend = (id: string, micro: number, at: string) =>
    e.DB.prepare(`INSERT INTO ai_usage_events (id, kind, model, units, unit_kind, base_cost_micro_usd, created_at) VALUES (?, 'page_build', 'm', 1, 'tokens', ?, ?)`).bind(id, micro, at).run();

  beforeEach(async () => { await e.DB.prepare('DELETE FROM ai_usage_events').run(); });

  it('is off when the env var is unset or not a positive number', async () => {
    await spend('a', 99_000_000, '2026-10-29T10:00:00Z');
    expect(await checkDailyAiSpend(newEnv(), now)).toBeNull();
    expect(await checkDailyAiSpend(newEnv({ AI_SPEND_ALERT_USD_PER_DAY: '0' }), now)).toBeNull();
    expect(await checkDailyAiSpend(newEnv({ AI_SPEND_ALERT_USD_PER_DAY: 'lots' }), now)).toBeNull();
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('stays quiet under the line and ignores yesterday', async () => {
    const env = newEnv({ AI_SPEND_ALERT_USD_PER_DAY: '50' });
    await spend('a', 30_000_000, '2026-10-29T10:00:00Z');
    await spend('b', 40_000_000, '2026-10-28T23:00:00Z');
    expect(await checkDailyAiSpend(env, now)).toEqual({ spentUsd: 30, alerted: false });
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('alerts once when it crosses the line, however often the hourly check runs', async () => {
    const env = newEnv({ AI_SPEND_ALERT_USD_PER_DAY: '50' });
    await spend('a', 30_000_000, '2026-10-29T10:00:00Z');
    await checkDailyAiSpend(env, now);
    await spend('b', 25_000_000, '2026-10-29T12:00:00Z');
    expect(await checkDailyAiSpend(env, now)).toEqual({ spentUsd: 55, alerted: true });
    await checkDailyAiSpend(env, new Date('2026-10-29T16:00:00Z'));
    expect(alertOps).toHaveBeenCalledTimes(1);
    expect(alertOps.mock.calls[0][2][0]).toContain('$55.00');
  });

  it('alerts again the next day', async () => {
    const env = newEnv({ AI_SPEND_ALERT_USD_PER_DAY: '10' });
    await spend('a', 20_000_000, '2026-10-29T10:00:00Z');
    await spend('b', 20_000_000, '2026-10-30T10:00:00Z');
    await checkDailyAiSpend(env, now);
    await checkDailyAiSpend(env, new Date('2026-10-30T15:00:00Z'));
    expect(alertOps).toHaveBeenCalledTimes(2);
  });
});

describe('wired into both provider stacks', () => {
  const meter = { workspaceId: null, userId: null, kind: 'page_build' };
  const refuse = (status: number, body: string) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, { status }));

  it('streamChat (text stack) alerts on a 402 from our gateway key, and not on a customer key', async () => {
    const { streamChat } = await import('../../../src/data/agent/anthropic');
    const env = newEnv({ VERCEL_AI_GATEWAY: 'gw-key' });
    refuse(402, '{"error":{"message":"no credits"}}');
    for await (const _ of streamChat(env, meter, [{ role: 'user', content: 'hi' }], 's', '')) void _;
    expect(alertOps).toHaveBeenCalledTimes(1);
    alertOps.mockClear();
    const byok = { provider: 'openai' as const, apiKey: 'customer-key', model: 'm', baseUrl: 'https://api.openai.com/v1' };
    for await (const _ of streamChat(newEnv({ VERCEL_AI_GATEWAY: 'gw-key' }), meter, [{ role: 'user', content: 'hi' }], 's', '', 100, byok)) void _;
    expect(alertOps).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('the crew provider (tool-calling stack) alerts on insufficient_quota', async () => {
    const { getCrewProvider } = await import('../../../src/crew/provider');
    const env = newEnv({ OPENAI_API_KEY: 'sk-ours' });
    refuse(429, '{"error":{"code":"insufficient_quota"}}');
    const provider = getCrewProvider(env)!;
    const events = [];
    for await (const ev of provider.streamTurn({ system: 's', transcript: [{ role: 'user', text: 'hi' }], tools: [], maxTokens: 10, meter })) events.push(ev);
    expect(events[0]).toMatchObject({ type: 'error' });
    expect(alertOps).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
