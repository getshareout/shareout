import { describe, expect, it, vi } from 'vitest';
import { routePerfApi } from '../../../src/router/api/perf';
import { routePresenceApi } from '../../../src/router/api/presence';
import { PresenceCoordinator } from '../../../src/realtime/presence-coordinator';
import type { FetchContext } from '../../../src/router/context';
import type { Env } from '../../../src/types';

const ART = 'art_deadbeef';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) } as unknown as KVNamespace;
}

function ctx(path: string, body: unknown, env: Partial<Env>, ip: string): FetchContext {
  const request = new Request(`https://shareout.site${path}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'text/plain', 'cf-connecting-ip': ip, 'user-agent': 'ua' },
  });
  return { request, env: env as Env, url: new URL(request.url), path, hostname: 'shareout.site', addCORS: (r: Response) => r };
}

describe('f67 perf beacon', () => {
  it('blocks: one caller cannot write unlimited samples', async () => {
    const inserts = vi.fn();
    const DB = { prepare: () => ({ bind: () => ({ run: async () => { inserts(); return {}; } }) }) };
    const env = { DB, RATE_LIMIT_KV: kv() } as unknown as Env;
    for (let i = 0; i < 1500; i++) await routePerfApi(ctx('/v1/perf', { a: ART, fcp: 100 }, env, '7.7.7.7'));
    expect(inserts.mock.calls.length).toBeLessThan(1500);
    expect(inserts.mock.calls.length).toBeGreaterThanOrEqual(1200);
    const before = inserts.mock.calls.length;
    await routePerfApi(ctx('/v1/perf', { a: ART, fcp: 100 }, env, '8.8.8.8'));
    expect(inserts.mock.calls.length).toBe(before + 1);
  });
});

describe('f68 presence beacon', () => {
  it('blocks: one caller cannot beat unlimited times', async () => {
    const beat = vi.fn(async () => new Response(null, { status: 204 }));
    const PRESENCE = { idFromName: (n: string) => n, get: () => ({ fetch: beat }) };
    const env = { PRESENCE, RATE_LIMIT_KV: kv() } as unknown as Env;
    for (let i = 0; i < 6500; i++) await routePresenceApi(ctx('/v1/presence', { a: ART }, env, '7.7.7.7'));
    expect(beat.mock.calls.length).toBeLessThan(6500);
    expect(beat.mock.calls.length).toBeGreaterThanOrEqual(6000);
  });

  it('blocks: the coordinator stops tracking new viewer ids past its cap', async () => {
    let alarm: number | null = null;
    const state = { storage: { getAlarm: async () => alarm, setAlarm: async (t: number) => { alarm = t; } } } as unknown as DurableObjectState;
    const doo = new PresenceCoordinator(state, {} as Env);
    const send = (viewerId: string) => doo.fetch(new Request('https://presence/beat', { method: 'POST', body: JSON.stringify({ viewerId }) }));
    for (let i = 0; i < 5100; i++) await send(`v${i}`);
    const { count } = (await (await doo.fetch(new Request('https://presence/count'))).json()) as { count: number };
    expect(count).toBe(5000);
    await send('v0');
    expect(((await (await doo.fetch(new Request('https://presence/count'))).json()) as { count: number }).count).toBe(5000);
  });
});
