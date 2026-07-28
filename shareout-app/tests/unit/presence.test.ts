import { describe, expect, it, vi, afterEach } from 'vitest';
import { injectPresenceBeacon } from '../../src/serve/presence-beacon';
import { routePresenceApi } from '../../src/router/api/presence';
import { PresenceCoordinator } from '../../src/realtime/presence-coordinator';
import type { FetchContext } from '../../src/router/context';
import type { Env } from '../../src/types';

const ARTIFACT_ID = 'art_deadbeef';

// Minimal DO namespace mock: every idFromName resolves to one shared stub whose fetch
// records the beat bodies it received, so the endpoint test can assert what was forwarded.
function makePresenceNs() {
  const beats: { viewerId?: string }[] = [];
  const stub = {
    fetch: vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body) beats.push(JSON.parse(init.body as string));
      return new Response(null, { status: 204 });
    }),
  };
  const ns = {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => stub),
  } as unknown as Env['PRESENCE'];
  return { ns, beats, stub };
}

function makeCtx(body: string, ns: Env['PRESENCE']): FetchContext {
  const request = new Request('https://shareout.site/v1/presence', {
    method: 'POST',
    body,
    headers: { 'content-type': 'text/plain', 'cf-connecting-ip': '1.2.3.4', 'user-agent': 'test' },
  });
  return {
    request,
    env: { PRESENCE: ns } as unknown as Env,
    url: new URL(request.url),
    path: '/v1/presence',
    hostname: 'shareout.site',
    addCORS: (r: Response) => r,
  };
}

describe('injectPresenceBeacon', () => {
  it('appends a heartbeat script carrying the artifact id and endpoint', async () => {
    const resp = new Response('<html><head></head><body>hi</body></html>', { headers: { 'content-type': 'text/html' } });
    const out = await injectPresenceBeacon(resp, ARTIFACT_ID, 'https://shareout.site').text();
    expect(out).toContain('shareout.site/v1/presence');
    expect(out).toContain(ARTIFACT_ID);
    expect(out).toContain('visibilitychange');
    // injected exactly once though both head and body handlers are registered
    expect(out.match(/v1\/presence/g)?.length).toBe(1);
    // the hand-rolled IIFE must be syntactically valid JS
    const body = out.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(() => new Function(body)).not.toThrow();
  });
});

describe('POST /v1/presence — heartbeat sink', () => {
  it('forwards a beat to the artifact DO and 204s', async () => {
    const { ns, beats } = makePresenceNs();
    const res = await routePresenceApi(makeCtx(JSON.stringify({ a: ARTIFACT_ID }), ns));
    expect(res?.status).toBe(204);
    expect((ns.idFromName as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(ARTIFACT_ID);
    expect(beats.length).toBe(1);
    expect(typeof beats[0].viewerId).toBe('string');
    expect(beats[0].viewerId).toBeTruthy();
  });

  it('drops a malformed artifact id without a beat', async () => {
    const { ns, beats } = makePresenceNs();
    const res = await routePresenceApi(makeCtx(JSON.stringify({ a: 'evil; DROP' }), ns));
    expect(res?.status).toBe(204);
    expect(beats.length).toBe(0);
  });

  it('ignores non-POST / non-presence paths', async () => {
    const { ns } = makePresenceNs();
    const ctx = makeCtx('{}', ns);
    expect(await routePresenceApi({ ...ctx, path: '/v1/other' })).toBeNull();
  });
});

describe('PresenceCoordinator — concurrent-viewer gauge', () => {
  afterEach(() => vi.restoreAllMocks());

  function makeDO() {
    let alarm: number | null = null;
    const storage = {
      getAlarm: vi.fn(async () => alarm),
      setAlarm: vi.fn(async (t: number) => { alarm = t; }),
    };
    const state = { storage } as unknown as DurableObjectState;
    return { do: new PresenceCoordinator(state, {} as Env), storage };
  }
  const beat = (viewerId: string) => new Request('https://presence/beat', { method: 'POST', body: JSON.stringify({ viewerId }) });
  const count = () => new Request('https://presence/count');

  it('counts distinct viewers and arms the sweep alarm on first beat', async () => {
    const { do: dobj, storage } = makeDO();
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await dobj.fetch(beat('a'));
    await dobj.fetch(beat('b'));
    await dobj.fetch(beat('a')); // same viewer re-beats → still distinct count of 2
    const res = await dobj.fetch(count());
    expect(await res.json()).toEqual({ count: 2 });
    expect(storage.setAlarm).toHaveBeenCalledTimes(1); // armed once, not per beat
  });

  it('prunes viewers past the 45s TTL', async () => {
    const { do: dobj } = makeDO();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await dobj.fetch(beat('a'));
    now.mockReturnValue(1_000_000 + 30_000); // 30s later, fresh beat from b
    await dobj.fetch(beat('b'));
    now.mockReturnValue(1_000_000 + 50_000); // a is 50s stale (>45s), b is 20s old
    const res = await dobj.fetch(count());
    expect(await res.json()).toEqual({ count: 1 });
  });

  it('alarm reschedules while viewers remain, stops when empty', async () => {
    const { do: dobj, storage } = makeDO();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await dobj.fetch(beat('a'));
    storage.setAlarm.mockClear();
    await dobj.alarm(); // viewer still fresh → reschedule
    expect(storage.setAlarm).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 60_000); // a now stale
    storage.setAlarm.mockClear();
    await dobj.alarm(); // empty → no reschedule
    expect(storage.setAlarm).not.toHaveBeenCalled();
  });
});
