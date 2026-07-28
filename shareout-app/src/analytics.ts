import type { Env, ViewEventMessage } from './types';
import { getViewerTracking, type ViewerTrackingEntry } from './view-tracking';

export interface AnalyticsSummary {
  totalViews: number;
  uniqueVisitors: number;
  dailyStats: Array<{
    date: string;
    views: number;
  }>;
  topReferrers: Array<{ name: string; count: number }>;
  topCountries: Array<{ name: string; count: number }>;
  viewerTracking: ViewerTrackingEntry[];
  perf: ArtifactPerf;
}

// Real-user load-time percentiles (opt-017), computed at read time over the most recent
// PERF_SAMPLE_CAP rows. p75 is the headline ("looks loaded" for most viewers); samples
// gates the UI (a percentile off a handful of points is noise). null = no data yet.
export interface ArtifactPerf {
  samples: number;
  lcp_p75: number | null;
  fcp_p75: number | null;
  dcl_p75: number | null;
  ttfb_p75: number | null;
}

export async function trackPageView(
  env: Env,
  request: Request,
  artifactId: string,
  path?: string
): Promise<void> {
  try {
    const cfData = (request as { cf?: { country?: string } }).cf;
    const ip = request.headers.get('cf-connecting-ip') || '';
    const userAgent = request.headers.get('user-agent') || '';
    const referrer = request.headers.get('referer') || '';

    // Resolve everything at view time: the visitor hash is date-dependent and the
    // consumer has no request, and the timestamp must reflect when the view happened
    // (not when it's flushed), so day-bucketing stays exact across a flush delay.
    const event: ViewEventMessage = {
      id: crypto.randomUUID(),
      artifact_id: artifactId,
      visitor_hash: await hashVisitor(ip, userAgent),
      created_at: new Date().toISOString(),
      user_agent: userAgent.slice(0, 255),
      referrer: referrer.slice(0, 500),
      country: cfData?.country || 'XX',
      path: path || '/',
    };

    // Hot path: hand the write to the queue (batched into D1 by the consumer). The
    // synchronous INSERT is the fallback when no queue is bound (local dev / rollback).
    if (env.VIEWS_QUEUE) {
      await env.VIEWS_QUEUE.send(event);
    } else {
      await viewInsertStatement(env, event).run();
    }
  } catch {
    // Silent fail - analytics should never break serving
  }
}

// Single source of truth for the analytics_events write, shared by the synchronous
// fallback and the queue consumer. INSERT OR IGNORE on the id PK makes at-least-once
// queue redelivery idempotent (a re-flushed event with the same id is a no-op).
function viewInsertStatement(env: Env, e: ViewEventMessage): D1PreparedStatement {
  return env.DB.prepare(`
    INSERT OR IGNORE INTO analytics_events
      (id, artifact_id, event_type, visitor_hash, created_at, user_agent, referrer, country, path)
    VALUES (?, ?, 'view', ?, ?, ?, ?, ?, ?)
  `).bind(
    e.id,
    e.artifact_id,
    e.visitor_hash,
    e.created_at,
    e.user_agent,
    e.referrer,
    e.country,
    e.path
  );
}

// Queue consumer: flush a batch of view events to D1 in one batched write. On any
// failure the whole batch is retried (idempotent via INSERT OR IGNORE); after
// max_retries it lands in the dead-letter queue rather than being lost.
export async function handleViewEventBatch(
  batch: MessageBatch<ViewEventMessage>,
  env: Env
): Promise<void> {
  if (batch.messages.length === 0) return;
  try {
    await env.DB.batch(batch.messages.map(m => viewInsertStatement(env, m.body)));
    batch.ackAll();
  } catch {
    batch.retryAll();
  }
}

export async function hashVisitor(ip: string, userAgent: string): Promise<string> {
  const data = new TextEncoder().encode(ip + userAgent + new Date().toDateString());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Read-time percentile cap. p75 over the last 500 views is a stable rolling signal and
// bounds the scan (the (artifact_id, created_at DESC) index makes it an index range). Raising
// this trades query cost for a longer averaging window.
const PERF_SAMPLE_CAP = 500;

// Nearest-rank percentile over a numeric array. Returns null for an empty set.
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

// Load-time p75s for an artifact, computed live over its most recent samples. Each
// metric percentiles only its own non-null values (a sample may carry FCP but no LCP).
export async function getArtifactPerf(env: Env, artifactId: string): Promise<ArtifactPerf> {
  const empty: ArtifactPerf = { samples: 0, lcp_p75: null, fcp_p75: null, dcl_p75: null, ttfb_p75: null };
  try {
    const rows = (await env.DB.prepare(`
      SELECT fcp, lcp, dcl, ttfb FROM artifact_perf
      WHERE artifact_id = ? ORDER BY created_at DESC LIMIT ?
    `).bind(artifactId, PERF_SAMPLE_CAP).all<{ fcp: number | null; lcp: number | null; dcl: number | null; ttfb: number | null }>()).results || [];
    if (rows.length === 0) return empty;
    const col = (k: 'fcp' | 'lcp' | 'dcl' | 'ttfb') =>
      rows.map(r => r[k]).filter((v): v is number => typeof v === 'number');
    return {
      samples: rows.length,
      lcp_p75: percentile(col('lcp'), 75),
      fcp_p75: percentile(col('fcp'), 75),
      dcl_p75: percentile(col('dcl'), 75),
      ttfb_p75: percentile(col('ttfb'), 75),
    };
  } catch {
    return empty;
  }
}

export async function getAnalytics(
  env: Env,
  artifactId: string,
  days: number = 7
): Promise<AnalyticsSummary> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  try {
    // Get aggregated daily stats
    const dailyResult = await env.DB.prepare(`
      SELECT date, views, unique_visitors, top_referrers, top_countries
      FROM analytics_daily
      WHERE artifact_id = ? AND date >= ?
      ORDER BY date DESC
    `).bind(artifactId, startDateStr).all<{
      date: string;
      views: number;
      unique_visitors: number;
      top_referrers: string | null;
      top_countries: string | null;
    }>();

    const dailyStats = dailyResult.results || [];

    let totalViews = 0;
    let uniqueVisitors = 0;
    const referrerCounts: Record<string, number> = {};
    const countryCounts: Record<string, number> = {};

    for (const day of dailyStats) {
      totalViews += day.views;
      uniqueVisitors += day.unique_visitors;

      if (day.top_referrers) {
        try {
          const refs = JSON.parse(day.top_referrers) as Array<{ name: string; count: number }>;
          for (const ref of refs) {
            referrerCounts[ref.name] = (referrerCounts[ref.name] || 0) + ref.count;
          }
        } catch { /* ignore parse errors */ }
      }

      if (day.top_countries) {
        try {
          const countries = JSON.parse(day.top_countries) as Array<{ name: string; count: number }>;
          for (const country of countries) {
            countryCounts[country.name] = (countryCounts[country.name] || 0) + country.count;
          }
        } catch { /* ignore parse errors */ }
      }
    }

    // Also include today's live events (not yet aggregated)
    const todayStr = new Date().toISOString().split('T')[0];
    const todayStart = Math.floor(new Date(todayStr).getTime() / 1000);

    const [todayTotalsResult, todayReferrersResult, todayCountriesResult] = await env.DB.batch([
      env.DB.prepare(`
        SELECT COUNT(*) as views, COUNT(DISTINCT visitor_hash) as unique_visitors
        FROM analytics_events
        WHERE artifact_id = ? AND created_at >= ?
      `).bind(artifactId, todayStart),
      env.DB.prepare(`
        SELECT referrer, COUNT(*) as count
        FROM analytics_events
        WHERE artifact_id = ? AND created_at >= ? AND referrer != ''
        GROUP BY referrer
        ORDER BY count DESC
        LIMIT 10
      `).bind(artifactId, todayStart),
      env.DB.prepare(`
        SELECT country, COUNT(*) as count
        FROM analytics_events
        WHERE artifact_id = ? AND created_at >= ? AND country != 'XX'
        GROUP BY country
        ORDER BY count DESC
        LIMIT 10
      `).bind(artifactId, todayStart),
    ]);

    const todayEvents = todayTotalsResult.results?.[0] as
      | { views: number; unique_visitors: number }
      | undefined;

    if (todayEvents) {
      totalViews += todayEvents.views;
      uniqueVisitors += todayEvents.unique_visitors;

      for (const ref of (todayReferrersResult.results || []) as Array<{ referrer: string; count: number }>) {
        const hostname = extractHostname(ref.referrer);
        if (hostname && hostname !== 'direct') {
          referrerCounts[hostname] = (referrerCounts[hostname] || 0) + ref.count;
        }
      }

      for (const c of (todayCountriesResult.results || []) as Array<{ country: string; count: number }>) {
        countryCounts[c.country] = (countryCounts[c.country] || 0) + c.count;
      }
    }

    const topReferrers = Object.entries(referrerCounts)
      .filter(([name]) => name && name !== 'direct')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const topCountries = Object.entries(countryCounts)
      .filter(([name]) => name && name !== 'XX')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const viewerTracking = await getViewerTracking(env, artifactId);
    const perf = await getArtifactPerf(env, artifactId);

    return {
      totalViews,
      uniqueVisitors,
      dailyStats: dailyStats.map(d => ({ date: d.date, views: d.views })),
      topReferrers,
      topCountries,
      viewerTracking,
      perf,
    };
  } catch {
    return emptyAnalytics();
  }
}

export interface AccountAnalytics {
  range: number;
  totals: { views: number; uniques: number; activeArtifacts: number };
  prev: { views: number; uniques: number };
  perf: ArtifactPerf;
  series: Array<{ date: string; views: number; uniques: number }>;
  topArtifacts: Array<{ artifact_id: string; name: string; slug: string | null; views: number; uniques: number; lastViewed: string }>;
  topCountries: Array<{ name: string; count: number }>;
  topReferrers: Array<{ name: string; count: number }>;
}

function emptyAccountAnalytics(range: number): AccountAnalytics {
  return {
    range,
    totals: { views: 0, uniques: 0, activeArtifacts: 0 },
    prev: { views: 0, uniques: 0 },
    perf: { samples: 0, lcp_p75: null, fcp_p75: null, dcl_p75: null, ttfb_p75: null },
    series: [], topArtifacts: [], topCountries: [], topReferrers: [],
  };
}

const UTC_DAY = 86400_000;
function dayStr(ms: number): string { return new Date(ms).toISOString().split('T')[0]; }

/**
 * Account-wide analytics across every artifact owned by the user's linked accounts.
 * Trend + totals come from analytics_daily (history; raw events are pruned after ~2d);
 * the current day is unioned in live from analytics_events. Owner scope is a subquery so
 * the bound-param list stays tiny regardless of how many artifacts the user has.
 */
export async function getAccountAnalytics(
  env: Env,
  userIds: string[],
  days: number = 30,
): Promise<AccountAnalytics> {
  if (!userIds.length) return emptyAccountAnalytics(days);
  const uPh = userIds.map(() => '?').join(',');
  const owned = `(SELECT id FROM artifacts WHERE owner_id IN (${uPh}) AND deleted_at IS NULL)`;

  const now = Date.now();
  const todayStr = dayStr(now);
  const todayStart = Math.floor(new Date(todayStr).getTime() / 1000);
  const startStr = dayStr(now - (days - 1) * UTC_DAY);
  const prevStartStr = dayStr(now - (2 * days - 1) * UTC_DAY);

  try {
    // Daily rollup rows in the window (through yesterday) + today's live events.
    const [dailyRes, todayRes, prevRes, topRes, todayTopRes, perfRes, activeRes] = await env.DB.batch([
      env.DB.prepare(`SELECT date, SUM(views) AS views, SUM(unique_visitors) AS uniques,
          json_group_array(top_countries) AS countries, json_group_array(top_referrers) AS referrers
        FROM analytics_daily WHERE artifact_id IN ${owned} AND date >= ? AND date < ?
        GROUP BY date ORDER BY date`).bind(...userIds, startStr, todayStr),
      env.DB.prepare(`SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS uniques
        FROM analytics_events WHERE artifact_id IN ${owned} AND created_at >= ?`).bind(...userIds, todayStart),
      env.DB.prepare(`SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(unique_visitors),0) AS uniques
        FROM analytics_daily WHERE artifact_id IN ${owned} AND date >= ? AND date < ?`).bind(...userIds, prevStartStr, startStr),
      env.DB.prepare(`SELECT ad.artifact_id, a.name, COALESCE(d.slug, a.slug) AS slug,
          SUM(ad.views) AS views, SUM(ad.unique_visitors) AS uniques, MAX(ad.date) AS last
        FROM analytics_daily ad
        JOIN artifacts a ON a.id = ad.artifact_id
        LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
        WHERE ad.artifact_id IN ${owned} AND ad.date >= ?
        GROUP BY ad.artifact_id ORDER BY views DESC LIMIT 20`).bind(...userIds, startStr),
      env.DB.prepare(`SELECT artifact_id, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS uniques
        FROM analytics_events WHERE artifact_id IN ${owned} AND created_at >= ?
        GROUP BY artifact_id`).bind(...userIds, todayStart),
      env.DB.prepare(`SELECT fcp, lcp, dcl, ttfb FROM artifact_perf
        WHERE artifact_id IN ${owned} AND created_at >= ? ORDER BY created_at DESC LIMIT 2000`)
        .bind(...userIds, new Date((todayStart - (days - 1) * 86400) * 1000).toISOString()),
      env.DB.prepare(`SELECT COUNT(DISTINCT artifact_id) AS n FROM analytics_daily
        WHERE artifact_id IN ${owned} AND date >= ?`).bind(...userIds, startStr),
    ]);

    const dailyRows = (dailyRes.results || []) as Array<{ date: string; views: number; uniques: number; countries: string; referrers: string }>;
    const seriesMap = new Map<string, { views: number; uniques: number }>();
    const countryCounts: Record<string, number> = {};
    const referrerCounts: Record<string, number> = {};
    const mergeJsonArray = (wrapped: string, sink: Record<string, number>) => {
      let outer: string[] = [];
      try { outer = JSON.parse(wrapped) as string[]; } catch { return; }
      for (const inner of outer) {
        if (!inner) continue;
        try {
          for (const it of JSON.parse(inner) as Array<{ name: string; count: number }>) {
            if (it && it.name) sink[it.name] = (sink[it.name] || 0) + (it.count || 0);
          }
        } catch { /* ignore */ }
      }
    };
    let totalViews = 0, totalUniques = 0;
    for (const r of dailyRows) {
      seriesMap.set(r.date, { views: r.views || 0, uniques: r.uniques || 0 });
      totalViews += r.views || 0; totalUniques += r.uniques || 0;
      mergeJsonArray(r.countries, countryCounts);
      mergeJsonArray(r.referrers, referrerCounts);
    }

    const today = (todayRes.results?.[0] as { views: number; uniques: number } | undefined) || { views: 0, uniques: 0 };
    if (today.views) {
      const cur = seriesMap.get(todayStr) || { views: 0, uniques: 0 };
      seriesMap.set(todayStr, { views: cur.views + today.views, uniques: cur.uniques + today.uniques });
      totalViews += today.views; totalUniques += today.uniques;
    }

    // Zero-filled day series across the whole window.
    const series: AccountAnalytics['series'] = [];
    for (let i = 0; i < days; i++) {
      const d = dayStr(now - (days - 1 - i) * UTC_DAY);
      const v = seriesMap.get(d);
      series.push({ date: d, views: v?.views || 0, uniques: v?.uniques || 0 });
    }

    // Merge today's live per-artifact counts into the ranking.
    const todayTop = new Map<string, { views: number; uniques: number }>();
    for (const r of (todayTopRes.results || []) as Array<{ artifact_id: string; views: number; uniques: number }>) {
      todayTop.set(r.artifact_id, { views: r.views, uniques: r.uniques });
    }
    const topArtifacts = ((topRes.results || []) as Array<{ artifact_id: string; name: string; slug: string | null; views: number; uniques: number; last: string }>)
      .map(r => {
        const t = todayTop.get(r.artifact_id);
        return {
          artifact_id: r.artifact_id, name: r.name, slug: r.slug,
          views: (r.views || 0) + (t?.views || 0),
          uniques: (r.uniques || 0) + (t?.uniques || 0),
          lastViewed: t ? todayStr : r.last,
        };
      })
      .sort((a, b) => b.views - a.views)
      .slice(0, 20);

    const perfRows = (perfRes.results || []) as Array<{ fcp: number | null; lcp: number | null; dcl: number | null; ttfb: number | null }>;
    const pcol = (k: 'fcp' | 'lcp' | 'dcl' | 'ttfb') => perfRows.map(r => r[k]).filter((v): v is number => typeof v === 'number');
    const perf: ArtifactPerf = {
      samples: perfRows.length,
      lcp_p75: percentile(pcol('lcp'), 75), fcp_p75: percentile(pcol('fcp'), 75),
      dcl_p75: percentile(pcol('dcl'), 75), ttfb_p75: percentile(pcol('ttfb'), 75),
    };

    const rank = (m: Record<string, number>, drop: string) => Object.entries(m)
      .filter(([n]) => n && n !== drop).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));

    const prev = (prevRes.results?.[0] as { views: number; uniques: number } | undefined) || { views: 0, uniques: 0 };
    const activeArtifacts = ((activeRes.results?.[0] as { n: number } | undefined)?.n) || 0;

    return {
      range: days,
      totals: { views: totalViews, uniques: totalUniques, activeArtifacts },
      prev: { views: prev.views || 0, uniques: prev.uniques || 0 },
      perf, series, topArtifacts,
      topCountries: rank(countryCounts, 'XX'),
      topReferrers: rank(referrerCounts, 'direct'),
    };
  } catch {
    return emptyAccountAnalytics(days);
  }
}

function extractHostname(referrer: string): string {
  try {
    return new URL(referrer).hostname;
  } catch {
    return referrer;
  }
}

function emptyAnalytics(): AnalyticsSummary {
  return {
    totalViews: 0,
    uniqueVisitors: 0,
    dailyStats: [],
    topReferrers: [],
    topCountries: [],
    viewerTracking: [],
    perf: { samples: 0, lcp_p75: null, fcp_p75: null, dcl_p75: null, ttfb_p75: null },
  };
}

// Batch size for the per-artifact top-referrer/-country UPDATEs. Each env.DB.batch
// call is one subrequest, so chunking keeps the daily rollup well under the
// 1,000-subrequest Worker cap. Matches the pattern in data/tables.ts.
const AGG_BATCH_SIZE = 100;

// Max distinct artifacts aggregated per tick (opt-006). The rollup advances a cursor
// across hourly ticks instead of doing a whole day at once, so per-run cost is bounded
// to ~ceil(SLICE/100) batch subrequests + a small constant, no matter how many distinct
// artifacts were viewed in a day — removing the ~99.6k distinct-artifacts/day ceiling.
// ~5k keeps both subrequests (~54) and isolate memory (top-10 referrer/country rows
// pulled in) comfortably bounded.
const CURSOR_SLICE_SIZE = 5000;

interface AggCursor {
  date: string;
  lastArtifactId: string;
}

/**
 * Advance the daily analytics rollup by one bounded slice of artifacts (opt-006).
 *
 * Runs every scheduled tick. Picks the day to work on — an in-progress cursor, else
 * yesterday if not yet aggregated — aggregates the next slice of artifact_ids strictly
 * after the cursor, and advances the cursor. When a day is fully drained it records the
 * watermark (only then — so cleanupOldEvents can't delete a partially-aggregated day)
 * and rolls the cursor to the next still-past day, or clears it.
 *
 * Returns the number of artifacts aggregated this tick (0 when idle or on completion).
 * The analytics_daily read shape is unchanged from the whole-day rollup it replaces.
 */
export async function aggregateDailyStats(env: Env): Promise<number> {
  let cursor = await loadAggCursor(env);
  if (!cursor) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = utcDateString(yesterday);
    // Already rolled up by a prior tick — nothing to do.
    if (await isDayAggregated(env, dateStr)) return 0;
    cursor = { date: dateStr, lastArtifactId: '' };
  }

  const startTs = Math.floor(new Date(cursor.date).getTime() / 1000);
  const endTs = startTs + 86400;

  // Next bounded, contiguous slice of artifacts for this day. Ordering by artifact_id
  // makes the slice the range (lastArtifactId, sliceMax], which every aggregation
  // statement below scopes to — no unbounded IN-list, bounded isolate memory.
  const sliceResult = await env.DB.prepare(`
    SELECT DISTINCT artifact_id FROM analytics_events
    WHERE created_at >= ?1 AND created_at < ?2 AND artifact_id > ?3
    ORDER BY artifact_id
    LIMIT ?4
  `).bind(startTs, endTs, cursor.lastArtifactId, CURSOR_SLICE_SIZE).all<{ artifact_id: string }>();

  const slice = sliceResult.results || [];

  if (slice.length === 0) {
    // Day fully drained (or had no events): record the watermark — only now is it safe
    // for cleanupOldEvents to delete this day's raw events — then roll the cursor to the
    // next still-past day if there's a backlog, else clear it.
    await recordAggregationWatermark(env, cursor.date);
    await rollCursorToNextDay(env, cursor.date);
    return 0;
  }

  const sliceMax = slice[slice.length - 1].artifact_id;
  await aggregateArtifactRange(env, cursor.date, startTs, endTs, cursor.lastArtifactId, sliceMax);
  await saveAggCursor(env, cursor.date, sliceMax);
  return slice.length;
}

// Aggregate exactly the artifacts in the range (afterId, untilId] for `dateStr`. Same
// output as the original whole-day rollup (counts upsert + denormalized totals +
// windowed top referrers/countries), scoped to the cursor's slice.
async function aggregateArtifactRange(
  env: Env,
  dateStr: string,
  startTs: number,
  endTs: number,
  afterId: string,
  untilId: string
): Promise<void> {
  // Counts for the slice in a single grouped upsert. UNIQUE(artifact_id, date) backs
  // the ON CONFLICT; re-running a slice is idempotent (full overwrite of counts).
  await env.DB.prepare(`
    INSERT INTO analytics_daily (id, artifact_id, date, views, unique_visitors, top_referrers, top_countries)
    SELECT lower(hex(randomblob(16))), artifact_id, ?1,
           COUNT(*), COUNT(DISTINCT visitor_hash), '[]', '[]'
    FROM analytics_events
    WHERE created_at >= ?2 AND created_at < ?3 AND artifact_id > ?4 AND artifact_id <= ?5
    GROUP BY artifact_id
    ON CONFLICT(artifact_id, date) DO UPDATE SET
      views = excluded.views,
      unique_visitors = excluded.unique_visitors
  `).bind(dateStr, startTs, endTs, afterId, untilId).run();

  // Refresh the denormalized per-artifact lifetime totals for the slice's artifacts
  // (opt-005). Full recompute per artifact keeps the invariant
  // artifact_view_totals == SUM(analytics_daily) and is idempotent.
  await env.DB.prepare(`
    INSERT INTO artifact_view_totals (artifact_id, views, unique_visitors, updated_at)
    SELECT artifact_id, COALESCE(SUM(views), 0), COALESCE(SUM(unique_visitors), 0), ?1
    FROM analytics_daily
    WHERE artifact_id IN (
      SELECT artifact_id FROM analytics_daily
      WHERE date = ?2 AND artifact_id > ?3 AND artifact_id <= ?4
    )
    GROUP BY artifact_id
    ON CONFLICT(artifact_id) DO UPDATE SET
      views = excluded.views,
      unique_visitors = excluded.unique_visitors,
      updated_at = excluded.updated_at
  `).bind(new Date().toISOString(), dateStr, afterId, untilId).run();

  // Top referrers / countries: one windowed query each (top-10 per artifact),
  // then a chunked batch of UPDATEs keyed by (artifact_id, date).
  const referrerRows = await env.DB.prepare(`
    WITH ranked AS (
      SELECT artifact_id, referrer, COUNT(*) AS c,
             ROW_NUMBER() OVER (PARTITION BY artifact_id ORDER BY COUNT(*) DESC) AS rn
      FROM analytics_events
      WHERE created_at >= ?1 AND created_at < ?2 AND artifact_id > ?3 AND artifact_id <= ?4 AND referrer != ''
      GROUP BY artifact_id, referrer
    )
    SELECT artifact_id,
           json_group_array(json_object('referrer', referrer, 'count', c)) AS items
    FROM ranked WHERE rn <= 10 GROUP BY artifact_id
  `).bind(startTs, endTs, afterId, untilId).all<{ artifact_id: string; items: string }>();

  const countryRows = await env.DB.prepare(`
    WITH ranked AS (
      SELECT artifact_id, country, COUNT(*) AS c,
             ROW_NUMBER() OVER (PARTITION BY artifact_id ORDER BY COUNT(*) DESC) AS rn
      FROM analytics_events
      WHERE created_at >= ?1 AND created_at < ?2 AND artifact_id > ?3 AND artifact_id <= ?4 AND country != 'XX'
      GROUP BY artifact_id, country
    )
    SELECT artifact_id,
           json_group_array(json_object('name', country, 'count', c)) AS items
    FROM ranked WHERE rn <= 10 GROUP BY artifact_id
  `).bind(startTs, endTs, afterId, untilId).all<{ artifact_id: string; items: string }>();

  // Hostname extraction stays a JS post-process over the small top-10 set
  // (SQLite has no URL parser); the stored shape is unchanged: [{name, count}].
  const referrerJson = new Map<string, string>();
  for (const row of referrerRows.results || []) {
    let items: Array<{ referrer: string; count: number }> = [];
    try {
      items = JSON.parse(row.items) as Array<{ referrer: string; count: number }>;
    } catch {
      items = [];
    }
    const top = items.map(r => ({ name: extractHostname(r.referrer), count: r.count }));
    referrerJson.set(row.artifact_id, JSON.stringify(top));
  }

  const countryJson = new Map<string, string>();
  for (const row of countryRows.results || []) {
    countryJson.set(row.artifact_id, row.items || '[]');
  }

  const artifactIds = new Set<string>([...referrerJson.keys(), ...countryJson.keys()]);
  const updates = [...artifactIds].map(artifactId =>
    env.DB.prepare(`
      UPDATE analytics_daily SET top_referrers = ?, top_countries = ?
      WHERE artifact_id = ? AND date = ?
    `).bind(referrerJson.get(artifactId) ?? '[]', countryJson.get(artifactId) ?? '[]', artifactId, dateStr)
  );

  for (let i = 0; i < updates.length; i += AGG_BATCH_SIZE) {
    await env.DB.batch(updates.slice(i, i + AGG_BATCH_SIZE));
  }
}

function utcDateString(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function loadAggCursor(env: Env): Promise<AggCursor | null> {
  const row = await env.DB.prepare(
    `SELECT date, last_artifact_id FROM analytics_agg_cursor WHERE id = 1`
  ).first<{ date: string; last_artifact_id: string }>();
  return row ? { date: row.date, lastArtifactId: row.last_artifact_id } : null;
}

async function saveAggCursor(env: Env, date: string, lastArtifactId: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO analytics_agg_cursor (id, date, last_artifact_id, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      date = excluded.date,
      last_artifact_id = excluded.last_artifact_id,
      updated_at = excluded.updated_at
  `).bind(date, lastArtifactId, new Date().toISOString()).run();
}

async function clearAggCursor(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM analytics_agg_cursor WHERE id = 1`).run();
}

async function isDayAggregated(env: Env, dateStr: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS present FROM analytics_agg_state WHERE date = ?`
  ).bind(dateStr).first<{ present: number }>();
  return !!row;
}

// After a day completes, point the cursor at the next still-past, not-yet-aggregated
// day so a multi-day backlog drains day-by-day; otherwise clear it (steady state).
async function rollCursorToNextDay(env: Env, completedDate: string): Promise<void> {
  const next = new Date(`${completedDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextStr = utcDateString(next);
  const today = utcDateString(new Date());
  if (nextStr < today && !(await isDayAggregated(env, nextStr))) {
    await saveAggCursor(env, nextStr, '');
  } else {
    await clearAggCursor(env);
  }
}

async function recordAggregationWatermark(env: Env, dateStr: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO analytics_agg_state (date, completed_at) VALUES (?, ?)
    ON CONFLICT(date) DO UPDATE SET completed_at = excluded.completed_at
  `).bind(dateStr, now).run();
}

export async function cleanupOldEvents(env: Env): Promise<number> {
  // Keep a 2-day floor (never delete very recent events) AND only delete events
  // whose day was successfully aggregated (present in analytics_agg_state). This
  // makes a failed/missed aggregation a *delayed* cleanup rather than permanent
  // data loss — un-aggregated days survive until a later run catches up.
  const cutoff = new Date(Date.now() - 2 * 86400 * 1000).toISOString();

  const result = await env.DB.prepare(`
    DELETE FROM analytics_events
    WHERE created_at < ?1
      AND date(created_at) IN (
        SELECT date FROM analytics_agg_state
      )
  `).bind(cutoff).run();

  // Perf samples (opt-017) have no rollup to gate on — they're read live over a capped
  // recent window — so prune on a flat 30-day retention. Best-effort; a failure here
  // must not block the analytics_events cleanup count returned below.
  try {
    const perfCutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    await env.DB.prepare(`DELETE FROM artifact_perf WHERE created_at < ?1`).bind(perfCutoff).run();
  } catch {
    // Table missing (pre-migration) or write failure — skip.
  }

  return result.meta.changes || 0;
}
