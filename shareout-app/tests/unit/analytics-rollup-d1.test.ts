// The view rollup and the live "today" counts on real D1 with the real schema.
// analytics_events.created_at is ISO text; binding unix seconds there compares as text
// ('2026-…' >= '1795…' is always true, '2026-…' < '1795…' never), so the rollup counted
// nothing and "today" counted every raw event. The mocked tests in analytics.test.ts
// could not see that. Days it marked done with nothing counted are picked up on their own.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from './helpers/migrated-db';
import { aggregateDailyStats, getAccountAnalytics, getAnalytics } from '../../src/analytics';

const user = { id: 'usr_rollup', email: 'rollup@example.com' };
const WS = 'wsp_rollup';
const ART = 'art_rollup';
const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const TODAY = day(0), YESTERDAY = day(1), TWO_AGO = day(2);

async function drain() {
  for (let i = 0; i < 10; i++) {
    await aggregateDailyStats(e);
    if (!(await e.DB.prepare('SELECT 1 FROM analytics_agg_cursor').first())) return;
  }
}
const daily = (date: string) =>
  e.DB.prepare('SELECT views, unique_visitors AS uniques FROM analytics_daily WHERE artifact_id = ? AND date = ?')
    .bind(ART, date).first<{ views: number; uniques: number }>();

beforeAll(async () => {
  await applyMigrations();
  const view = (id: string, at: string, visitor: string) =>
    e.DB.prepare(`INSERT INTO analytics_events (id, artifact_id, event_type, visitor_hash, created_at, referrer, country)
                  VALUES (?, ?, 'view', ?, ?, 'https://news.example.com/a', 'AR')`).bind(id, ART, visitor, at);
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(user.id, user.email, 'Rollup'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'Rollup WS', 'rollup-ws', user.id),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Daily sales', 'rollup-daily', ?, ?, 'workspace')")
      .bind(ART, user.id, WS),
    view('ev_y1', `${YESTERDAY}T09:00:00.000Z`, 'v1'),
    view('ev_y2', `${YESTERDAY}T12:30:00.000Z`, 'v1'),
    view('ev_y3', `${YESTERDAY}T23:59:59.999Z`, 'v2'),
    view('ev_old', `${TWO_AGO}T10:00:00.000Z`, 'v3'),
    view('ev_t1', `${TODAY}T00:00:00.000Z`, 'v4'),
    view('ev_t2', `${TODAY}T00:00:00.500Z`, 'v4'),
  ]);
  await drain();
});

describe('view rollup on real D1', () => {
  it("counts yesterday's views into the daily table, with referrer and country", async () => {
    expect(await daily(YESTERDAY)).toEqual({ views: 3, uniques: 2 });
    const top = await e.DB.prepare('SELECT top_referrers, top_countries FROM analytics_daily WHERE artifact_id = ? AND date = ?')
      .bind(ART, YESTERDAY).first<{ top_referrers: string; top_countries: string }>();
    expect(JSON.parse(top!.top_referrers)).toEqual([{ name: 'news.example.com', count: 3 }]);
    expect(JSON.parse(top!.top_countries)).toEqual([{ name: 'AR', count: 3 }]);
    const totals = await e.DB.prepare('SELECT views FROM artifact_view_totals WHERE artifact_id = ?').bind(ART).first<{ views: number }>();
    expect(totals!.views).toBe(3);
  });

  it('adds only today\'s raw events on top of the daily table', async () => {
    const acct = await getAccountAnalytics(e, [user.id], 7, WS);
    expect(acct.totals.views).toBe(5); // 3 rolled up yesterday + 2 live today; the older raw event is not "today"
    expect(acct.series.find((s) => s.date === TODAY)!.views).toBe(2);
    expect(acct.series.find((s) => s.date === YESTERDAY)!.views).toBe(3);
    expect(acct.totals.activeArtifacts).toBe(1);
    expect(acct.topArtifacts[0]).toMatchObject({ artifact_id: ART, views: 5 });

    const one = await getAnalytics(e, ART, 7);
    expect(one.totalViews).toBe(5);
  });

  it('counts an artifact opened only today as active', async () => {
    const OTHER = 'art_rollup_today';
    await e.DB.batch([
      e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'New board', 'rollup-new', ?, ?, 'workspace')")
        .bind(OTHER, user.id, WS),
      e.DB.prepare("INSERT INTO analytics_events (id, artifact_id, event_type, visitor_hash, created_at) VALUES ('ev_new', ?, 'view', 'v9', ?)")
        .bind(OTHER, `${TODAY}T00:00:00.000Z`),
    ]);
    expect((await getAccountAnalytics(e, [user.id], 7, WS)).totals.activeArtifacts).toBe(2);
    await e.DB.prepare("DELETE FROM analytics_events WHERE id = 'ev_new'").run();
  });

  it('an idle tick with everything counted does nothing', async () => {
    expect(await aggregateDailyStats(e)).toBe(0);
    expect(await e.DB.prepare('SELECT 1 FROM analytics_agg_cursor').first()).toBeNull();
  });

  it('counts, on its own, a day the broken rollup marked done with nothing counted', async () => {
    // What the broken rollup left behind: the day marked done, its raw events still there,
    // no daily row. A marked day with no events at all is left alone.
    const EMPTY = day(3);
    await e.DB.batch([
      e.DB.prepare("INSERT INTO analytics_agg_state (date, completed_at) VALUES (?, '2026-01-01T00:00:00.000Z')").bind(TWO_AGO),
      e.DB.prepare("INSERT INTO analytics_agg_state (date, completed_at) VALUES (?, '2026-01-01T00:00:00.000Z')").bind(EMPTY),
    ]);
    expect(await daily(TWO_AGO)).toBeNull();
    expect(await aggregateDailyStats(e)).toBe(1); // picked up by the next tick, no manual step
    await drain();
    expect(await daily(TWO_AGO)).toEqual({ views: 1, uniques: 1 });
    expect(await daily(YESTERDAY)).toEqual({ views: 3, uniques: 2 });
    expect(await e.DB.prepare('SELECT 1 FROM analytics_agg_state WHERE date = ?').bind(TWO_AGO).first()).not.toBeNull();
    expect(await aggregateDailyStats(e)).toBe(0);
    expect((await getAccountAnalytics(e, [user.id], 7, WS)).totals.views).toBe(6);
  });
});
