// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';

const sendMessage = vi.fn(async () => {});
vi.mock('../../src/telegram/client', () => ({ sendMessage: (...a: unknown[]) => sendMessage(...a) }));

const countExceededMemoryKills = vi.fn(async () => null as number | null);
vi.mock('../../src/observability/cf-worker-analytics', () => ({ countExceededMemoryKills: (...a: unknown[]) => countExceededMemoryKills(...a) }));

import { recordRequestMetric, getWindowSummary } from '../../src/observability/store';
import { fireAlert, alertOnError, runHealthSweep, notifyAdmin } from '../../src/observability/alerts';
import { configuredSuperadminTelegramChatIds, resolveSuperadminTelegramChatIds } from '../../src/superadmin/recipients';
import { observe, shouldSkipObservability } from '../../src/observability';

// The shipped roster is empty by design (a public repo must not grant super-admin to a
// baked-in address), so tests that need one mock the roster import.
const testRoster = vi.hoisted(() => ({
  default: {
    recipients: [{ email: 'admin@example.com', telegramChatId: 555000 }, { email: 'ops@example.com' }],
  },
}));
vi.mock('../../superadmin-recipients.json', () => testRoster);

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
  sendMessage.mockClear();
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

describe('resolveSuperadminTelegramChatIds', () => {
  const rosterIds = configuredSuperadminTelegramChatIds();

  it('honours the explicit override', async () => {
    const ids = await resolveSuperadminTelegramChatIds({ ALERT_TELEGRAM_CHAT_ID: '424242' } as Env);
    expect(ids).toEqual([424242]);
  });

  it('merges roster chat ids with linked superadmin chats and caches them', async () => {
    const db = makeDb({ all: [{ chat_id: '987654' }, { chat_id: '111222' }] });
    const kv = makeKv();
    const env = { DB: db, RATE_LIMIT_KV: kv } as Env;
    expect(await resolveSuperadminTelegramChatIds(env)).toEqual([...rosterIds, 987654, 111222]);
    expect((kv as unknown as { _store: Map<string, string> })._store.get('superadmin:telegram_chats:v1')).toBe(
      JSON.stringify([...rosterIds, 987654, 111222])
    );
  });

  it('negative-caches when only roster ids exist and D1 has no links', async () => {
    const db = makeDb({ all: [] });
    const kv = makeKv();
    const env = { DB: db, RATE_LIMIT_KV: kv } as Env;
    expect(await resolveSuperadminTelegramChatIds(env)).toEqual(rosterIds);
    expect((kv as unknown as { _store: Map<string, string> })._store.get('superadmin:telegram_chats:v1')).toBe(
      JSON.stringify(rosterIds)
    );
  });

  it('returns the first resolved chat when only one is needed', async () => {
    const db = makeDb({ all: [{ chat_id: '987654' }, { chat_id: '111222' }] });
    const env = { DB: db, RATE_LIMIT_KV: makeKv() } as Env;
    const chatIds = await resolveSuperadminTelegramChatIds(env);
    expect(chatIds[0] ?? null).toBe(configuredSuperadminTelegramChatIds()[0] ?? 987654);
  });
});

describe('fireAlert — throttle', () => {
  it('sends once per recipient then mutes repeats within the cooldown', async () => {
    const kv = makeKv();
    const env = { ALERT_TELEGRAM_CHAT_ID: '111', RATE_LIMIT_KV: kv } as Env;
    await fireAlert(env, 'k1', 'boom', 300);
    await fireAlert(env, 'k1', 'boom again', 300);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no chat resolves', async () => {
    const env = { ALERT_TELEGRAM_CHAT_ID: 'bad', RATE_LIMIT_KV: makeKv() } as Env;
    await fireAlert(env, 'k2', 'boom', 300);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('notifyAdmin', () => {
  it('sends to every resolved admin chat and reports success', async () => {
    const env = { ALERT_TELEGRAM_CHAT_ID: '777', RATE_LIMIT_KV: makeKv() } as Env;
    const ok = await notifyAdmin(env, 'hello admin');
    expect(ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toBe(777);
    expect(String(sendMessage.mock.calls[0][2])).toBe('hello admin');
  });

  it('returns false (no send) when no admin chat resolves', async () => {
    const env = { ALERT_TELEGRAM_CHAT_ID: 'bad', RATE_LIMIT_KV: makeKv() } as Env;
    expect(await notifyAdmin(env, 'hi')).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('alertOnError', () => {
  it('formats an HTTP 5xx alert', async () => {
    const env = { ALERT_TELEGRAM_CHAT_ID: '1', RATE_LIMIT_KV: makeKv() } as Env;
    await alertOnError(env, { status: 502, outcome: 'http_error', method: 'GET', path: '/home' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(String(sendMessage.mock.calls[0][2])).toContain('HTTP 502');
  });

  it('formats an exception alert', async () => {
    const env = { ALERT_TELEGRAM_CHAT_ID: '1', RATE_LIMIT_KV: makeKv() } as Env;
    await alertOnError(env, { status: 500, outcome: 'exception', path: '/x', message: 'kaboom' });
    expect(String(sendMessage.mock.calls[0][2])).toContain('kaboom');
  });
});

describe('runHealthSweep — thresholds', () => {
  const kv = () => makeKv();

  beforeEach(() => {
    countExceededMemoryKills.mockResolvedValue(null);
  });

  it('alerts on an elevated 5xx rate', async () => {
    const db = makeDb({ first: { requests: 1000, status_5xx: 30, exceptions: 0, b_le_3000: 0, b_gt_3000: 0 } });
    await runHealthSweep({ DB: db, ALERT_TELEGRAM_CHAT_ID: '1', RATE_LIMIT_KV: kv() } as Env);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(String(sendMessage.mock.calls[0][2])).toContain('5xx');
  });

  it('stays quiet on a clean hour', async () => {
    const db = makeDb({ first: { requests: 1000, status_5xx: 0, exceptions: 0, b_le_3000: 0, b_gt_3000: 0 } });
    await runHealthSweep({ DB: db, ALERT_TELEGRAM_CHAT_ID: '1', RATE_LIMIT_KV: kv() } as Env);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ignores low-traffic hours', async () => {
    const db = makeDb({ first: { requests: 5, status_5xx: 5, exceptions: 5, b_le_3000: 0, b_gt_3000: 0 } });
    await runHealthSweep({ DB: db, ALERT_TELEGRAM_CHAT_ID: '1', RATE_LIMIT_KV: kv() } as Env);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('stays quiet on a slow but low-traffic hour (e.g. 9/33)', async () => {
    const db = makeDb({ first: { requests: 33, status_5xx: 0, exceptions: 0, b_le_3000: 9, b_gt_3000: 0 } });
    await runHealthSweep({ DB: db, ALERT_TELEGRAM_CHAT_ID: '1', RATE_LIMIT_KV: kv() } as Env);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('alerts on a genuine high-volume slowdown (e.g. 2153/2226)', async () => {
    const db = makeDb({ first: { requests: 2226, status_5xx: 0, exceptions: 0, b_le_3000: 2000, b_gt_3000: 153 } });
    await runHealthSweep({ DB: db, ALERT_TELEGRAM_CHAT_ID: '1', RATE_LIMIT_KV: kv() } as Env);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(String(sendMessage.mock.calls[0][2])).toContain('Slow responses');
  });

  it('alerts when CF Analytics reports exceededMemory kills', async () => {
    countExceededMemoryKills.mockResolvedValue(2);
    const db = makeDb({ first: { requests: 1000, status_5xx: 0, exceptions: 0, b_le_3000: 0, b_gt_3000: 0 } });
    await runHealthSweep({
      DB: db,
      ALERT_TELEGRAM_CHAT_ID: '1',
      RATE_LIMIT_KV: kv(),
      CF_API_TOKEN: 'tok',
      CF_ACCOUNT_ID: 'acct',
    } as Env);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(String(sendMessage.mock.calls[0][2])).toContain('memory limit exceeded');
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
    observe({ DB: db, ALERT_TELEGRAM_CHAT_ID: '1', RATE_LIMIT_KV: makeKv() } as Env, ctx, {
      status: 200,
      durationMs: 12,
      outcome: 'success',
    });
    await Promise.all(tasks);
    expect(db._calls.some((c) => c.sql.includes('health_metrics_hourly'))).toBe(true);
    expect(db._calls.some((c) => c.sql.includes('ops_error_log'))).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not log or alert on a 404', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    const { ctx, tasks } = ctxCapture();
    observe({ DB: db, ALERT_TELEGRAM_CHAT_ID: '1', RATE_LIMIT_KV: makeKv() } as Env, ctx, {
      status: 404,
      durationMs: 5,
      outcome: 'http_error',
      path: '/missing',
    });
    await Promise.all(tasks);
    expect(db._calls.some((c) => c.sql.includes('ops_error_log'))).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('logs and alerts on a 500', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    const { ctx, tasks } = ctxCapture();
    observe({ DB: db, ALERT_TELEGRAM_CHAT_ID: '1', RATE_LIMIT_KV: makeKv() } as Env, ctx, {
      status: 500,
      durationMs: 33,
      outcome: 'http_error',
      path: '/home',
      method: 'GET',
    });
    await Promise.all(tasks);
    expect(db._calls.some((c) => c.sql.includes('ops_error_log'))).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('skips localhost traffic before writing metrics or alerts', async () => {
    const db = makeDb() as ReturnType<typeof makeDb>;
    const { ctx, tasks } = ctxCapture();
    observe({ DB: db, ALERT_TELEGRAM_CHAT_ID: '1', RATE_LIMIT_KV: makeKv() } as Env, ctx, {
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
    expect(sendMessage).not.toHaveBeenCalled();
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
});
