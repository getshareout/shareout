import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aggregateDailyStats,
  cleanupOldEvents,
  getAnalytics,
  handleViewEventBatch,
  trackPageView,
} from '../../src/analytics';
import type { Env, ViewEventMessage } from '../../src/types';

const ARTIFACT_ID = 'art_1';

type PreparedCapture = { sql: string; args: unknown[] };

type DbHandlers = {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
  batch?: (stmts: PreparedCapture[]) => void;
};

function makeDbMock(handlers: DbHandlers = {}): Env['DB'] {
  // first/all/run are exposed both directly on the prepared statement and after bind(),
  // so statements with no bind params (e.g. the cursor load/clear) work too.
  const makeStmt = (sql: string, bindArgs: unknown[]): Record<string, unknown> => ({
    sql,
    args: bindArgs,
    bind: vi.fn((...args: unknown[]) => makeStmt(sql, args)),
    first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
    all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
    run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true, meta: { changes: 1 } }),
  });
  return {
    prepare: vi.fn((sql: string) => makeStmt(sql, [])),
    batch: vi.fn(async (stmts: PreparedCapture[]) => {
      handlers.batch?.(stmts);
      return stmts.map((stmt) => {
        const sql = stmt.sql;
        const args = stmt.args;
        if (sql.includes('COUNT(*) as views')) {
          const row = handlers.first?.(sql, ...args);
          return { success: true, results: row ? [row] : [] };
        }
        if (sql.includes('GROUP BY referrer') || sql.includes('GROUP BY country')) {
          const all = handlers.all?.(sql, ...args) as { results?: unknown[] } | undefined;
          return { success: true, results: all?.results ?? [] };
        }
        return { success: true, meta: { changes: 1 } };
      });
    }),
  } as unknown as Env['DB'];
}

function makeEnv(db: Env['DB']): Env {
  return { DB: db } as Env;
}

function makeRequest(overrides: {
  ip?: string;
  userAgent?: string;
  referrer?: string;
  country?: string;
} = {}): Request {
  const headers = new Headers();
  if (overrides.ip !== undefined) headers.set('cf-connecting-ip', overrides.ip);
  if (overrides.userAgent !== undefined) headers.set('user-agent', overrides.userAgent);
  if (overrides.referrer !== undefined) headers.set('referer', overrides.referrer);

  return {
    headers,
    cf: overrides.country ? { country: overrides.country } : undefined,
  } as unknown as Request;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('trackPageView', () => {
  it('enqueues the view to VIEWS_QUEUE when bound, without a synchronous D1 write', async () => {
    const send = vi.fn(async () => {});
    const prepare = vi.fn();
    const env = { DB: { prepare }, VIEWS_QUEUE: { send } } as unknown as Env;

    await trackPageView(
      env,
      makeRequest({
        ip: '1.2.3.4',
        userAgent: 'TestAgent/1.0',
        referrer: 'https://google.com/search',
        country: 'US',
      }),
      ARTIFACT_ID,
      '/page'
    );

    expect(send).toHaveBeenCalledTimes(1);
    const event = send.mock.calls[0][0] as ViewEventMessage;
    expect(event.artifact_id).toBe(ARTIFACT_ID);
    expect(event.country).toBe('US');
    expect(event.path).toBe('/page');
    expect(typeof event.id).toBe('string');
    expect(typeof event.created_at).toBe('string');
    expect(typeof event.visitor_hash).toBe('string');
    // Hot path is queue-only: no per-view D1 INSERT when the queue is bound.
    expect(prepare).not.toHaveBeenCalled();
  });

  it('falls back to a synchronous INSERT OR IGNORE when no queue is bound', async () => {
    const run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }));
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ run })),
      })),
    } as unknown as Env['DB'];

    await trackPageView(
      makeEnv(db),
      makeRequest({
        ip: '1.2.3.4',
        userAgent: 'TestAgent/1.0',
        referrer: 'https://google.com/search',
        country: 'US',
      }),
      ARTIFACT_ID,
      '/page'
    );

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO analytics_events'));
    expect(run).toHaveBeenCalled();
  });

  it('uses defaults when headers and cf data are missing (fallback path)', async () => {
    const bind = vi.fn(() => ({ run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })) }));
    const db = {
      prepare: vi.fn(() => ({ bind })),
    } as unknown as Env['DB'];

    await trackPageView(makeEnv(db), new Request('https://example.com'), ARTIFACT_ID);

    // Bind order carries the pre-generated created_at between visitor_hash and user_agent.
    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      ARTIFACT_ID,
      expect.any(String),
      expect.any(String),
      '',
      '',
      'XX',
      '/'
    );
  });

  it('silently fails when the write throws', async () => {
    const db = {
      prepare: vi.fn(() => {
        throw new Error('DB down');
      }),
    } as unknown as Env['DB'];

    await expect(trackPageView(makeEnv(db), makeRequest(), ARTIFACT_ID)).resolves.toBeUndefined();
  });
});

describe('handleViewEventBatch', () => {
  const message = (overrides: Partial<ViewEventMessage> = {}): ViewEventMessage => ({
    id: 'evt_1',
    artifact_id: ARTIFACT_ID,
    visitor_hash: 'vh',
    created_at: '2024-06-01T02:40:00.000Z',
    user_agent: 'UA',
    referrer: '',
    country: 'XX',
    path: '/',
    ...overrides,
  });

  type Batch = Parameters<typeof handleViewEventBatch>[0];
  function makeBatch(bodies: ViewEventMessage[]) {
    return {
      queue: 'shareout-analytics-views',
      messages: bodies.map(body => ({ body })),
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as Batch;
  }

  it('flushes the batch via one INSERT OR IGNORE batch and acks on success', async () => {
    let batchedSql = '';
    let stmtCount = 0;
    const db = {
      prepare: vi.fn((sql: string) => ({ bind: vi.fn(() => ({ sql })) })),
      batch: vi.fn(async (stmts: Array<{ sql: string }>) => {
        batchedSql = stmts[0].sql;
        stmtCount = stmts.length;
        return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
      }),
    } as unknown as Env['DB'];

    const batch = makeBatch([message({ id: 'a' }), message({ id: 'b' })]);
    await handleViewEventBatch(batch, makeEnv(db));

    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(stmtCount).toBe(2);
    expect(batchedSql).toContain('INSERT OR IGNORE INTO analytics_events');
    expect(batch.ackAll).toHaveBeenCalled();
    expect(batch.retryAll).not.toHaveBeenCalled();
  });

  it('retries the whole batch when the D1 write fails (idempotent via INSERT OR IGNORE)', async () => {
    const db = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
      batch: vi.fn(async () => {
        throw new Error('D1 down');
      }),
    } as unknown as Env['DB'];

    const batch = makeBatch([message()]);
    await handleViewEventBatch(batch, makeEnv(db));

    expect(batch.retryAll).toHaveBeenCalled();
    expect(batch.ackAll).not.toHaveBeenCalled();
  });

  it('no-ops on an empty batch', async () => {
    const db = { prepare: vi.fn(), batch: vi.fn() } as unknown as Env['DB'];
    const batch = makeBatch([]);
    await handleViewEventBatch(batch, makeEnv(db));
    expect(db.batch).not.toHaveBeenCalled();
    expect(batch.ackAll).not.toHaveBeenCalled();
  });
});

describe('getAnalytics', () => {
  it('aggregates daily stats and today live events', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const db = makeDbMock({
      all: (sql) => {
        if (sql.includes('FROM analytics_daily')) {
          return {
            results: [
              {
                date: '2024-06-01',
                views: 10,
                unique_visitors: 5,
                top_referrers: JSON.stringify([{ name: 'google.com', count: 3 }]),
                top_countries: JSON.stringify([{ name: 'US', count: 4 }]),
              },
            ],
          };
        }
        if (sql.includes('GROUP BY referrer')) {
          return { results: [{ referrer: 'https://twitter.com/post', count: 2 }] };
        }
        if (sql.includes('GROUP BY country')) {
          return { results: [{ country: 'CA', count: 1 }] };
        }
        if (sql.includes('LEFT JOIN users u ON u.email = e.email')) {
          return {
            results: [
              {
                email: 'viewer@example.com',
                name: 'Vera Viewer',
                role: 'viewer',
                view_count: 2,
                first_viewed_at: 100,
                last_viewed_at: 200,
              },
            ],
          };
        }
        return { results: [] };
      },
      first: (sql) => {
        if (sql.includes('COUNT(*) as views')) {
          return { views: 3, unique_visitors: 2 };
        }
        return null;
      },
    });

    const summary = await getAnalytics(makeEnv(db), ARTIFACT_ID, 7);

    expect(summary.totalViews).toBe(13);
    expect(summary.uniqueVisitors).toBe(7);
    expect(summary.dailyStats).toEqual([{ date: '2024-06-01', views: 10 }]);
    expect(summary.topReferrers.some(r => r.name === 'google.com')).toBe(true);
    expect(summary.topReferrers.some(r => r.name === 'twitter.com')).toBe(true);
    expect(summary.topCountries.some(c => c.name === 'US')).toBe(true);
    expect(summary.topCountries.some(c => c.name === 'CA')).toBe(true);
    expect(summary.viewerTracking).toHaveLength(1);
    expect(summary.viewerTracking[0].email).toBe('viewer@example.com');
    expect(todayStr).toBeTruthy();
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(db.batch.mock.calls[0][0]).toHaveLength(3);
  });

  it('ignores malformed JSON in daily referrer/country fields', async () => {
    const db = makeDbMock({
      all: (sql) => {
        if (sql.includes('FROM analytics_daily')) {
          return {
            results: [
              {
                date: '2024-06-01',
                views: 1,
                unique_visitors: 1,
                top_referrers: '{bad',
                top_countries: '{bad',
              },
            ],
          };
        }
        return { results: [] };
      },
      first: () => ({ views: 0, unique_visitors: 0 }),
    });

    const summary = await getAnalytics(makeEnv(db), ARTIFACT_ID);
    expect(summary.totalViews).toBe(1);
    expect(summary.topReferrers).toEqual([]);
    expect(summary.topCountries).toEqual([]);
  });

  it('returns empty analytics on DB error', async () => {
    const db = {
      prepare: vi.fn(() => {
        throw new Error('fail');
      }),
    } as unknown as Env['DB'];

    const summary = await getAnalytics(makeEnv(db), ARTIFACT_ID);
    expect(summary).toEqual({
      totalViews: 0,
      uniqueVisitors: 0,
      dailyStats: [],
      topReferrers: [],
      topCountries: [],
      viewerTracking: [],
      perf: { samples: 0, lcp_p75: null, fcp_p75: null, dcl_p75: null, ttfb_p75: null },
    });
  });

  it('handles missing today events gracefully', async () => {
    const db = makeDbMock({
      all: () => ({ results: [] }),
      first: () => null,
    });

    const summary = await getAnalytics(makeEnv(db), ARTIFACT_ID);
    expect(summary.totalViews).toBe(0);
    expect(summary.viewerTracking).toEqual([]);
  });

  it('filters direct referrers and XX countries from top lists', async () => {
    const db = makeDbMock({
      all: (sql) => {
        if (sql.includes('FROM analytics_daily')) {
          return {
            results: [
              {
                date: '2024-06-01',
                views: 5,
                unique_visitors: 2,
                top_referrers: JSON.stringify([
                  { name: 'direct', count: 10 },
                  { name: 'example.com', count: 3 },
                ]),
                top_countries: JSON.stringify([
                  { name: 'XX', count: 5 },
                  { name: 'GB', count: 2 },
                ]),
              },
            ],
          };
        }
        return { results: [] };
      },
      first: () => ({ views: 0, unique_visitors: 0 }),
    });

    const summary = await getAnalytics(makeEnv(db), ARTIFACT_ID);
    expect(summary.topReferrers.find(r => r.name === 'direct')).toBeUndefined();
    expect(summary.topReferrers.find(r => r.name === 'example.com')).toBeDefined();
    expect(summary.topCountries.find(c => c.name === 'XX')).toBeUndefined();
    expect(summary.topCountries.find(c => c.name === 'GB')).toBeDefined();
  });
});

describe('aggregateDailyStats (cursor rollup, opt-006)', () => {
  // The rollup now advances a per-day cursor by a bounded slice of artifact_ids each
  // tick (set-based counts + windowed top-N within the slice's id range), and writes
  // the day's watermark ONLY when the cursor drains the day — so cleanupOldEvents can
  // never delete a partially-aggregated day. Returns the artifacts processed this tick.

  it('aggregates a bounded slice, advances the cursor, and does NOT watermark mid-day', async () => {
    let watermarkWritten = false;
    let savedCursorArgs: unknown[] | null = null;
    const db = makeDbMock({
      first: (sql) => {
        if (sql.includes('FROM analytics_agg_cursor')) return null; // no cursor yet
        if (sql.includes('FROM analytics_agg_state')) return null; // yesterday not aggregated
        return null;
      },
      all: (sql) => {
        if (sql.includes('SELECT DISTINCT artifact_id')) {
          return { results: [{ artifact_id: 'art_a' }, { artifact_id: 'art_b' }] };
        }
        return { results: [] }; // windowed referrer/country
      },
      run: (sql, ...args) => {
        if (sql.includes('INSERT INTO analytics_agg_state')) watermarkWritten = true;
        if (sql.includes('INSERT INTO analytics_agg_cursor')) savedCursorArgs = args;
        return { success: true, meta: { changes: 1 } };
      },
    });

    const processed = await aggregateDailyStats(makeEnv(db));
    expect(processed).toBe(2);
    // Mid-day: the watermark is withheld, so cleanupOldEvents won't touch this day.
    expect(watermarkWritten).toBe(false);
    // Cursor advanced to the slice's max artifact_id (bind order: date, last_artifact_id, ts).
    expect(savedCursorArgs?.[1]).toBe('art_b');
  });

  it('records the watermark and clears the cursor when the day is fully drained', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const ydStr = yesterday.toISOString().split('T')[0];

    let watermarkDate: string | null = null;
    let cursorCleared = false;
    const db = makeDbMock({
      first: (sql) =>
        sql.includes('FROM analytics_agg_cursor') ? { date: ydStr, last_artifact_id: 'zzz' } : null,
      all: () => ({ results: [] }), // no artifacts left in the day → drained
      run: (sql, ...args) => {
        if (sql.includes('INSERT INTO analytics_agg_state')) watermarkDate = args[0] as string;
        if (sql.includes('DELETE FROM analytics_agg_cursor')) cursorCleared = true;
        return { success: true, meta: { changes: 1 } };
      },
    });

    const processed = await aggregateDailyStats(makeEnv(db));
    expect(processed).toBe(0);
    expect(watermarkDate).toBe(ydStr); // watermark written only on completion
    expect(cursorCleared).toBe(true);
  });

  it('skips work (one cheap lookup) when yesterday is already aggregated', async () => {
    let sliceQueried = false;
    let watermarkWritten = false;
    const db = makeDbMock({
      first: (sql) => {
        if (sql.includes('FROM analytics_agg_cursor')) return null;
        if (sql.includes('FROM analytics_agg_state')) return { present: 1 };
        return null;
      },
      all: (sql) => {
        if (sql.includes('SELECT DISTINCT artifact_id')) sliceQueried = true;
        return { results: [] };
      },
      run: (sql) => {
        if (sql.includes('INSERT INTO analytics_agg_state')) watermarkWritten = true;
        return { success: true, meta: { changes: 1 } };
      },
    });

    const processed = await aggregateDailyStats(makeEnv(db));
    expect(processed).toBe(0);
    expect(sliceQueried).toBe(false);
    expect(watermarkWritten).toBe(false);
  });

  it('writes the watermark for a day with no events (vacuously complete)', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const ydStr = yesterday.toISOString().split('T')[0];

    let watermarkDate: string | null = null;
    const db = makeDbMock({
      first: () => null, // no cursor, yesterday not yet aggregated
      all: () => ({ results: [] }), // no events → empty slice
      run: (sql, ...args) => {
        if (sql.includes('INSERT INTO analytics_agg_state')) watermarkDate = args[0] as string;
        return { success: true, meta: { changes: 1 } };
      },
    });

    const processed = await aggregateDailyStats(makeEnv(db));
    expect(processed).toBe(0);
    expect(watermarkDate).toBe(ydStr);
  });

  it('extracts referrer hostnames and writes top lists via batched UPDATE', async () => {
    let referrerArg = '';
    let countryArg = '';
    const db = makeDbMock({
      first: () => null,
      all: (sql) => {
        if (sql.includes('SELECT DISTINCT artifact_id')) {
          return { results: [{ artifact_id: ARTIFACT_ID }] };
        }
        if (sql.includes('referrer')) {
          return {
            results: [
              {
                artifact_id: ARTIFACT_ID,
                items: JSON.stringify([{ referrer: 'https://google.com/search?q=x', count: 4 }]),
              },
            ],
          };
        }
        // country windowed query
        return {
          results: [{ artifact_id: ARTIFACT_ID, items: JSON.stringify([{ name: 'DE', count: 2 }]) }],
        };
      },
      batch: (stmts) => {
        // UPDATE bind order: top_referrers, top_countries, artifact_id, date
        referrerArg = stmts[0].args[0] as string;
        countryArg = stmts[0].args[1] as string;
      },
    });

    await aggregateDailyStats(makeEnv(db));
    expect(JSON.parse(referrerArg)).toEqual([{ name: 'google.com', count: 4 }]);
    expect(JSON.parse(countryArg)).toEqual([{ name: 'DE', count: 2 }]);
  });

  it('uses the raw referrer when hostname extraction fails', async () => {
    let referrerArg = '';
    const db = makeDbMock({
      first: () => null,
      all: (sql) => {
        if (sql.includes('SELECT DISTINCT artifact_id')) {
          return { results: [{ artifact_id: ARTIFACT_ID }] };
        }
        if (sql.includes('referrer')) {
          return {
            results: [
              {
                artifact_id: ARTIFACT_ID,
                items: JSON.stringify([{ referrer: 'not-a-valid-url', count: 1 }]),
              },
            ],
          };
        }
        return { results: [] };
      },
      batch: (stmts) => {
        referrerArg = stmts[0].args[0] as string;
      },
    });

    await aggregateDailyStats(makeEnv(db));
    expect(JSON.parse(referrerArg)).toEqual([{ name: 'not-a-valid-url', count: 1 }]);
  });
});

describe('cleanupOldEvents', () => {
  it('deletes old events and returns change count', async () => {
    const run = vi.fn(async () => ({ success: true, meta: { changes: 42 } }));
    const bind = vi.fn(() => ({ run }));
    const db = {
      prepare: vi.fn(() => ({ bind })),
    } as unknown as Env['DB'];

    const deleted = await cleanupOldEvents(makeEnv(db));
    expect(deleted).toBe(42);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM analytics_events'));
    expect(bind).toHaveBeenCalledWith(expect.any(String));
  });

  it('returns 0 when meta.changes is missing', async () => {
    const db = makeDbMock({
      run: () => ({ success: true, meta: {} }),
    });

    const deleted = await cleanupOldEvents(makeEnv(db));
    expect(deleted).toBe(0);
  });

  it('gates deletion on the aggregation watermark (only aggregated days)', async () => {
    let deleteSql = '';
    const db = makeDbMock({
      run: (sql) => {
        // cleanupOldEvents now also prunes artifact_perf (opt-017); capture only the
        // analytics_events delete so the watermark assertion isn't shadowed by it.
        if (sql.includes('DELETE FROM analytics_events')) deleteSql = sql;
        return { success: true, meta: { changes: 5 } };
      },
    });

    const deleted = await cleanupOldEvents(makeEnv(db));
    expect(deleted).toBe(5);
    // The DELETE must be scoped to days present in analytics_agg_state, so events
    // for un-aggregated days are never removed.
    expect(deleteSql).toContain('analytics_agg_state');
  });
});
