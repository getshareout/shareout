// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';

const countExceededMemoryKills = vi.fn(async () => null as number | null);
vi.mock('../../src/observability/cf-worker-analytics', () => ({ countExceededMemoryKills: (...a: unknown[]) => countExceededMemoryKills(...a) }));

import { recordRequestMetric, getWindowSummary } from '../../src/observability/store';
import { countsInRequestMetrics, observe, shouldSkipObservability } from '../../src/observability';
import { withRequestLogging } from '../../src/request-logging';

interface DbCall {
  sql: string;
  args: unknown[];
}

// Minimal D1 fake: records every prepare/bind, returns a fixed first()/all() result.
function makeDb(result?: { first?: unknown; all?: unknown[] }) {
  const calls: DbCall[] = [];
  const terminal = (sql: string, args: unknown[]) => ({
    run: async () => {
      calls.push({ sql, args });
      return { success: true, meta: { changes: 1 } };
    },
    all: async () => {
      calls.push({ sql, args });
      return { results: result?.all ?? [] };
    },
    first: async () => {
      calls.push({ sql, args });
      return result?.first ?? null;
    },
  });
  const db = {
    _calls: calls,
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => terminal(sql, args),
        ...terminal(sql, []),
      };
    },
  };
  return db as unknown as Env['DB'] & { _calls: DbCall[] };
}

function makeKv() {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: async (k: string) => (store.has(k) ? store.get(k)! : null),
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
    delete: async (k: string) => {
      store.delete(k);
    },
  } as unknown as Env['RATE_LIMIT_KV'] & { _store: Map<string, string> };
}

afterEach(() => {
});

describe('recordRequestMetric — bucketing', () => {
  it('counts a fast 2xx in the 100–300ms bucket', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    await recordRequestMetric({ DB: db } as Env, { status: 200, durationMs: 250, outcome: 'success' });
    // binds: hour, c2, c3, c4, c5, exc, d, le100, le300, le1000, le3000, gt3000, now
    const { args } = db._calls[0];
    expect(args[1]).toBe(1); // status_2xx
    expect(args[4]).toBe(0); // status_5xx
    expect(args[5]).toBe(0); // exceptions
    expect(args[6]).toBe(250); // duration
    expect(args[8]).toBe(1); // b_le_300
  });

  it('counts a slow 5xx in the >3s bucket', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    await recordRequestMetric({ DB: db } as Env, { status: 503, durationMs: 4200, outcome: 'http_error' });
    const { args } = db._calls[0];
    expect(args[4]).toBe(1); // status_5xx
    expect(args[11]).toBe(1); // b_gt_3000
    expect(args[5]).toBe(0); // not an exception
  });

  it('flags an exception', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    await recordRequestMetric({ DB: db } as Env, { status: 500, durationMs: 10, outcome: 'exception' });
    expect(db._calls[0].args[5]).toBe(1); // exceptions
  });
});

describe('getWindowSummary — math', () => {
  it('derives rate / averages from the SUM row', async () => {
    const db = makeDb({
      first: { requests: 1000, s4: 30, s5: 10, exc: 5, dsum: 50000, dmax: 8000, under300: 800, over1s: 50 },
    });
    const w = await getWindowSummary({ DB: db } as Env, 24);
    expect(w.requests).toBe(1000);
    expect(w.status4xx).toBe(30);
    expect(w.status5xx).toBe(10);
    expect(w.exceptions).toBe(5);
    expect(w.errorRatePct).toBeCloseTo(1.5); // (10+5)/1000
    expect(w.avgMs).toBe(50);
    expect(w.maxMs).toBe(8000);
    expect(w.pctUnder300).toBe(80);
    expect(w.pctOver1s).toBe(5);
  });

  it('is safe with zero traffic', async () => {
    const db = makeDb({ first: { requests: 0, s4: 0, s5: 0, exc: 0, dsum: 0, dmax: 0, under300: 0, over1s: 0 } });
    const w = await getWindowSummary({ DB: db } as Env, 1);
    expect(w.errorRatePct).toBe(0);
    expect(w.avgMs).toBe(0);
  });
});


describe('observe — routing', () => {
  function ctxCapture() {
    const tasks: Promise<unknown>[] = [];
    return { ctx: { waitUntil: (p: Promise<unknown>) => tasks.push(p) } as ExecutionContext, tasks };
  }

  it('records a 2xx without logging an error or alerting', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    const { ctx, tasks } = ctxCapture();
    observe({ DB: db, RATE_LIMIT_KV: makeKv() } as Env, ctx, {
      status: 200,
      durationMs: 12,
      outcome: 'success',
    });
    await Promise.all(tasks);
    expect(db._calls.some((c) => c.sql.includes('health_metrics_hourly'))).toBe(true);
    expect(db._calls.some((c) => c.sql.includes('ops_error_log'))).toBe(false);
  });

  it('does not log or alert on a 404', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    const { ctx, tasks } = ctxCapture();
    observe({ DB: db, RATE_LIMIT_KV: makeKv() } as Env, ctx, {
      status: 404,
      durationMs: 5,
      outcome: 'http_error',
      path: '/missing',
    });
    await Promise.all(tasks);
    expect(db._calls.some((c) => c.sql.includes('ops_error_log'))).toBe(false);
  });

  it('records a 500 to the error log', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    const { ctx, tasks } = ctxCapture();
    observe({ DB: db, RATE_LIMIT_KV: makeKv() } as Env, ctx, {
      status: 500,
      durationMs: 33,
      outcome: 'http_error',
      path: '/home',
      method: 'GET',
    });
    await Promise.all(tasks);
    expect(db._calls.some((c) => c.sql.includes('ops_error_log'))).toBe(true);
  });

  it('skips localhost traffic before writing metrics or alerts', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    const { ctx, tasks } = ctxCapture();
    observe({ DB: db, RATE_LIMIT_KV: makeKv() } as Env, ctx, {
      status: 500,
      durationMs: 20,
      outcome: 'http_error',
      method: 'GET',
      path: '/home',
      hostname: 'localhost',
    });
    await Promise.all(tasks);
    expect(tasks).toHaveLength(0);
    expect(db._calls).toHaveLength(0);
  });

  it('skips local request flags and the dev login route', async () => {
    expect(shouldSkipObservability({ isLocal: true, path: '/home' })).toBe(true);
    expect(shouldSkipObservability({ hostname: '127.0.0.1', path: '/home' })).toBe(true);
    expect(shouldSkipObservability({ hostname: 'localhost:55162', path: '/home' })).toBe(true);
    expect(shouldSkipObservability({ hostname: '[::1]', path: '/home' })).toBe(true);
    expect(shouldSkipObservability({ hostname: 'preview.localhost', path: '/home' })).toBe(true);
    expect(shouldSkipObservability({ hostname: 'shareout.site', path: '/auth/dev' })).toBe(true);
    expect(shouldSkipObservability({ hostname: 'shareout.site', path: '/home' })).toBe(false);
  });

  it('writes nothing for a preflight, a static asset or a beacon that succeeded', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    const { ctx, tasks } = ctxCapture();
    const env = { DB: db, RATE_LIMIT_KV: makeKv() } as Env;
    observe(env, ctx, { status: 204, durationMs: 1, outcome: 'success', method: 'OPTIONS', path: '/v1/data/art_1/json/k' });
    observe(env, ctx, { status: 200, durationMs: 3, outcome: 'success', method: 'GET', path: '/sdk/shareout.js' });
    observe(env, ctx, { status: 404, durationMs: 2, outcome: 'http_error', method: 'GET', path: '/t/art_gone.webp' });
    observe(env, ctx, { status: 204, durationMs: 2, outcome: 'success', method: 'POST', path: '/v1/presence' });
    await Promise.all(tasks);
    expect(tasks).toHaveLength(0);
    expect(db._calls).toHaveLength(0);
  });

  it('still counts and logs a static asset that fails', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    const { ctx, tasks } = ctxCapture();
    observe({ DB: db, RATE_LIMIT_KV: makeKv() } as Env, ctx, {
      status: 500, durationMs: 40, outcome: 'http_error', method: 'GET', path: '/t/art_abc.webp',
    });
    await Promise.all(tasks);
    expect(db._calls.some((c) => c.sql.includes('health_metrics_hourly'))).toBe(true);
    expect(db._calls.some((c) => c.sql.includes('ops_error_log'))).toBe(true);
  });

  it('counts page and API requests', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    const { ctx, tasks } = ctxCapture();
    const env = { DB: db, RATE_LIMIT_KV: makeKv() } as Env;
    observe(env, ctx, { status: 200, durationMs: 80, outcome: 'success', method: 'GET', path: '/home' });
    observe(env, ctx, { status: 200, durationMs: 30, outcome: 'success', method: 'POST', path: '/v1/data/art_1/json/k' });
    await Promise.all(tasks);
    expect(db._calls.filter((c) => c.sql.includes('health_metrics_hourly'))).toHaveLength(2);
  });
});

describe('countsInRequestMetrics', () => {
  it('leaves out CORS preflights on any path', () => {
    expect(countsInRequestMetrics({ method: 'OPTIONS', path: '/v1/data/art_1/json/k' })).toBe(false);
    expect(countsInRequestMetrics({ method: 'OPTIONS', path: '/mcp' })).toBe(false);
  });

  it('leaves out the static and beacon routes the router serves', () => {
    const staticPaths = [
      // shared bundles (router/shared-bundles.ts)
      '/sdk/shareout.js', '/sdk/v1/shareout.js', '/sdk/shareout.css', '/sdk/editor.js', '/sdk/comments-agent.js',
      '/sdk/home-shell.js', '/sdk/home-lens-admin.js', '/lib/team/chart@1.2.0.js', '/vendor/chart.js@4.4.1/dist/chart.umd.js',
      // brand images (brand/index.ts)
      '/brand/logo-mark.png', '/favicon.ico', '/favicon-32.png', '/apple-touch-icon.png',
      // thumbnails, workspace logos, app-shell files (router/serve-router.ts)
      '/t/art_abc123.webp', '/t/art_abc123_card.webp', '/wl/wsp_abc.png', '/manifest.webmanifest', '/sw.js',
    ];
    for (const path of staticPaths) expect(countsInRequestMetrics({ method: 'GET', path }), path).toBe(false);
    for (const path of ['/v1/perf', '/v1/presence', '/v1/funnel']) {
      expect(countsInRequestMetrics({ method: 'POST', path }), path).toBe(false);
    }
  });

  it('keeps pages, APIs and artifact routes', () => {
    const counted: Array<[string, string]> = [
      ['GET', '/'], ['GET', '/home'], ['GET', '/status'], ['GET', '/auth/login'],
      ['GET', '/a/q3-report/'], ['GET', '/a/q3-report/app.js'], ['GET', '/v1/artifacts'],
      ['GET', '/v1/artifacts/art_1/presence'], ['POST', '/v1/data/art_1/json/k'], ['POST', '/mcp'],
      ['GET', '/sdk'], ['GET', '/teams/preview'],
    ];
    for (const [method, path] of counted) expect(countsInRequestMetrics({ method, path }), `${method} ${path}`).toBe(true);
    expect(countsInRequestMetrics({})).toBe(true); // a failed cron run carries no path
  });
});

describe('withRequestLogging → observe', () => {
  it('keeps preflights and static assets off D1 and folds page requests in', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    const tasks: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => tasks.push(p) } as ExecutionContext;
    const env = { DB: db, LOG_LEVEL: 'error' } as Env;
    const send = (path: string, method = 'GET', status = 200) =>
      withRequestLogging(new Request(`https://shareout.example.com${path}`, { method }), env, ctx, async () => new Response(null, { status }));

    await send('/v1/data/art_1/json/k', 'OPTIONS', 204);
    await send('/sdk/shareout.js');
    await Promise.all(tasks);
    expect(db._calls).toHaveLength(0);

    await send('/home');
    await Promise.all(tasks);
    expect(db._calls.filter((c) => c.sql.includes('health_metrics_hourly'))).toHaveLength(1);
  });
});
