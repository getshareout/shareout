import { describe, expect, it, vi } from 'vitest';
import { getArtifactPerf } from '../../src/analytics';
import { routePerfApi } from '../../src/router/api/perf';
import { injectPerfBeacon } from '../../src/serve/perf-beacon';
import type { FetchContext } from '../../src/router/context';
import type { Env } from '../../src/types';

const ARTIFACT_ID = 'art_deadbeef';

type DbHandlers = {
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
};

// Mirrors the proven makeDbMock pattern in analytics.test.ts: first/all/run live on the
// prepared statement and again after bind(), so chains with or without bind() both work.
function makeDb(handlers: DbHandlers = {}): Env['DB'] {
  const makeStmt = (sql: string, bindArgs: unknown[]): Record<string, unknown> => ({
    bind: vi.fn((...args: unknown[]) => makeStmt(sql, args)),
    first: vi.fn(async () => null),
    all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
    run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true, meta: { changes: 1 } }),
  });
  return { prepare: vi.fn((sql: string) => makeStmt(sql, [])) } as unknown as Env['DB'];
}

function makeCtx(body: string, db: Env['DB']): FetchContext {
  const request = new Request('https://shareout.site/v1/perf', {
    method: 'POST',
    body,
    headers: { 'content-type': 'text/plain', 'cf-connecting-ip': '1.2.3.4', 'user-agent': 'test' },
  });
  return {
    request,
    env: { DB: db } as unknown as Env,
    url: new URL(request.url),
    path: '/v1/perf',
    hostname: 'shareout.site',
    addCORS: (r: Response) => r,
  };
}

describe('getArtifactPerf — read-time p75', () => {
  const env = (db: Env['DB']): Env => ({ DB: db } as unknown as Env);

  it('computes nearest-rank p75 per metric over recent rows', async () => {
    const db = makeDb({ all: (sql) => (sql.includes('artifact_perf') ? { results: [
      { fcp: 100, lcp: 200, dcl: 100, ttfb: 50 },
      { fcp: 200, lcp: 400, dcl: 200, ttfb: 100 },
      { fcp: 300, lcp: 600, dcl: 300, ttfb: 150 },
      { fcp: 400, lcp: 800, dcl: 400, ttfb: 200 },
    ] } : { results: [] }) });
    const perf = await getArtifactPerf(env(db), ARTIFACT_ID);
    expect(perf.samples).toBe(4);
    expect(perf.fcp_p75).toBe(300); // ceil(.75*4)=3 -> sorted[2]
    expect(perf.lcp_p75).toBe(600);
    expect(perf.ttfb_p75).toBe(150);
  });

  it('percentiles each metric only over its own non-null values', async () => {
    const db = makeDb({ all: (sql) => (sql.includes('artifact_perf') ? { results: [
      { fcp: 100, lcp: null, dcl: 100, ttfb: 50 },
      { fcp: 200, lcp: 900, dcl: 200, ttfb: 60 },
    ] } : { results: [] }) });
    const perf = await getArtifactPerf(env(db), ARTIFACT_ID);
    expect(perf.samples).toBe(2);
    expect(perf.lcp_p75).toBe(900); // single non-null lcp
  });

  it('returns nulls and zero samples when no data', async () => {
    const perf = await getArtifactPerf(env(makeDb()), ARTIFACT_ID);
    expect(perf).toEqual({ samples: 0, lcp_p75: null, fcp_p75: null, dcl_p75: null, ttfb_p75: null });
  });
});

describe('POST /v1/perf — beacon ingestion', () => {
  function captureInserts() {
    const inserts: unknown[][] = [];
    const db = makeDb({ run: (sql, ...args) => { if (sql.includes('INSERT INTO artifact_perf')) inserts.push(args); return { meta: { changes: 1 } }; } });
    return { inserts, db };
  }

  it('inserts a valid sample and 204s', async () => {
    const { inserts, db } = captureInserts();
    const res = await routePerfApi(makeCtx(JSON.stringify({ a: ARTIFACT_ID, fcp: 800, lcp: 2400, dcl: 1200, ttfb: 300 }), db));
    expect(res?.status).toBe(204);
    expect(inserts.length).toBe(1);
    // (id, artifact_id, ts, fcp, lcp, dcl, ttfb, visitor_hash, country)
    expect(inserts[0][1]).toBe(ARTIFACT_ID);
    expect(inserts[0].slice(3, 7)).toEqual([800, 2400, 1200, 300]);
  });

  it('drops a malformed artifact id without writing', async () => {
    const { inserts, db } = captureInserts();
    const res = await routePerfApi(makeCtx(JSON.stringify({ a: 'evil; DROP', fcp: 800 }), db));
    expect(res?.status).toBe(204);
    expect(inserts.length).toBe(0);
  });

  it('drops a sample with no FCP (no paint = noise)', async () => {
    const { inserts, db } = captureInserts();
    const res = await routePerfApi(makeCtx(JSON.stringify({ a: ARTIFACT_ID, lcp: 2400 }), db));
    expect(res?.status).toBe(204);
    expect(inserts.length).toBe(0);
  });

  it('nulls out-of-range timings but still records the FCP-valid sample', async () => {
    const { inserts, db } = captureInserts();
    // lcp negative, dcl absurd -> both dropped to null; fcp valid -> row kept
    await routePerfApi(makeCtx(JSON.stringify({ a: ARTIFACT_ID, fcp: 500, lcp: -1, dcl: 99999999, ttfb: 250 }), db));
    expect(inserts.length).toBe(1);
    expect(inserts[0].slice(3, 7)).toEqual([500, null, null, 250]);
  });

  it('ignores non-POST / non-perf paths', async () => {
    const ctx = makeCtx('{}', makeDb());
    expect(await routePerfApi({ ...ctx, path: '/v1/other' })).toBeNull();
  });
});

describe('injectPerfBeacon', () => {
  it('appends a beacon script carrying the artifact id and endpoint', async () => {
    const resp = new Response('<html><head></head><body>hi</body></html>', { headers: { 'content-type': 'text/html' } });
    const out = await injectPerfBeacon(resp, ARTIFACT_ID, 'https://shareout.site').text();
    expect(out).toContain('shareout.site/v1/perf');
    expect(out).toContain(ARTIFACT_ID);
    expect(out).toContain('navigator.sendBeacon');
    // injected exactly once though both head and body handlers are registered
    expect(out.match(/v1\/perf/g)?.length).toBe(1);
    // the hand-rolled IIFE must be syntactically valid JS
    const body = out.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(() => new Function(body)).not.toThrow();
  });
});
