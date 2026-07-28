import type { Env } from '../types';

// Self-hosted request telemetry persisted to D1. One row per UTC hour is updated
// in place (atomic upsert) from the request path, plus a bounded log of server
// errors. No external analytics API is involved — these numbers are exact.

export interface MetricEvent {
  status: number;
  durationMs: number;
  outcome: 'success' | 'http_error' | 'exception';
}

export interface ErrorEvent {
  status: number;
  outcome: 'http_error' | 'exception';
  method?: string;
  route?: string;
  path?: string;
  requestId?: string;
  message?: string;
  country?: string;
}

export interface HourRow {
  hour: string;
  requests: number;
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
  exceptions: number;
  dur_sum_ms: number;
  dur_max_ms: number;
  b_le_100: number;
  b_le_300: number;
  b_le_1000: number;
  b_le_3000: number;
  b_gt_3000: number;
}

export interface WindowSummary {
  hours: number;
  requests: number;
  status4xx: number;
  status5xx: number;
  exceptions: number;
  errorRatePct: number; // (5xx + exceptions) / requests
  avgMs: number;
  maxMs: number;
  pctUnder300: number;
  pctOver1s: number;
}

export interface ErrorRow {
  id: string;
  created_at: string;
  status: number;
  outcome: string;
  method: string | null;
  route: string | null;
  path: string | null;
  request_id: string | null;
  message: string | null;
  country: string | null;
}

function hourBucket(d = new Date()): string {
  return d.toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'
}

function hourCutoff(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString().slice(0, 13);
}

// Fold one request into its hour bucket. Single statement → atomic increments,
// safe under concurrency. Reuses numbered params (?N) so the per-request
// contribution is computed once in JS.
export async function recordRequestMetric(env: Env, m: MetricEvent): Promise<void> {
  const s = m.status;
  const c2 = s >= 200 && s < 300 ? 1 : 0;
  const c3 = s >= 300 && s < 400 ? 1 : 0;
  const c4 = s >= 400 && s < 500 ? 1 : 0;
  const c5 = s >= 500 ? 1 : 0;
  const exc = m.outcome === 'exception' ? 1 : 0;
  const d = Math.max(0, Math.round(m.durationMs || 0));
  const le100 = d <= 100 ? 1 : 0;
  const le300 = d > 100 && d <= 300 ? 1 : 0;
  const le1000 = d > 300 && d <= 1000 ? 1 : 0;
  const le3000 = d > 1000 && d <= 3000 ? 1 : 0;
  const gt3000 = d > 3000 ? 1 : 0;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO health_metrics_hourly
       (hour, requests, status_2xx, status_3xx, status_4xx, status_5xx, exceptions,
        dur_sum_ms, dur_max_ms, b_le_100, b_le_300, b_le_1000, b_le_3000, b_gt_3000, updated_at)
     VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
     ON CONFLICT(hour) DO UPDATE SET
       requests   = requests + 1,
       status_2xx = status_2xx + ?2,
       status_3xx = status_3xx + ?3,
       status_4xx = status_4xx + ?4,
       status_5xx = status_5xx + ?5,
       exceptions = exceptions + ?6,
       dur_sum_ms = dur_sum_ms + ?7,
       dur_max_ms = MAX(dur_max_ms, ?7),
       b_le_100   = b_le_100 + ?8,
       b_le_300   = b_le_300 + ?9,
       b_le_1000  = b_le_1000 + ?10,
       b_le_3000  = b_le_3000 + ?11,
       b_gt_3000  = b_gt_3000 + ?12,
       updated_at = ?13`
  )
    .bind(hourBucket(), c2, c3, c4, c5, exc, d, le100, le300, le1000, le3000, gt3000, now)
    .run();
}

// Persist a server error (5xx or unhandled exception) for the Health view's
// recent-errors panel. 4xx are intentionally not logged here (client noise /
// bot 404 floods); their counts still land in the hourly histogram.
export async function recordError(env: Env, e: ErrorEvent): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ops_error_log (id, created_at, status, outcome, method, route, path, request_id, message, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      e.status,
      e.outcome,
      e.method ?? null,
      e.route ?? null,
      e.path ?? null,
      e.requestId ?? null,
      (e.message ?? '').slice(0, 500) || null,
      e.country ?? null
    )
    .run();
}

export async function getHourlySeries(env: Env, hours = 48): Promise<HourRow[]> {
  const res = await env.DB.prepare(
    `SELECT hour, requests, status_2xx, status_3xx, status_4xx, status_5xx, exceptions,
            dur_sum_ms, dur_max_ms, b_le_100, b_le_300, b_le_1000, b_le_3000, b_gt_3000
     FROM health_metrics_hourly WHERE hour >= ? ORDER BY hour ASC`
  )
    .bind(hourCutoff(hours))
    .all<HourRow>();
  return res.results ?? [];
}

export async function getWindowSummary(env: Env, hours: number): Promise<WindowSummary> {
  const r = await env.DB.prepare(
    `SELECT COALESCE(SUM(requests),0)  AS requests,
            COALESCE(SUM(status_4xx),0) AS s4,
            COALESCE(SUM(status_5xx),0) AS s5,
            COALESCE(SUM(exceptions),0) AS exc,
            COALESCE(SUM(dur_sum_ms),0) AS dsum,
            COALESCE(MAX(dur_max_ms),0) AS dmax,
            COALESCE(SUM(b_le_100 + b_le_300),0) AS under300,
            COALESCE(SUM(b_le_3000 + b_gt_3000),0) AS over1s
     FROM health_metrics_hourly WHERE hour >= ?`
  )
    .bind(hourCutoff(hours))
    .first<{ requests: number; s4: number; s5: number; exc: number; dsum: number; dmax: number; under300: number; over1s: number }>();

  const requests = r?.requests ?? 0;
  const s5 = r?.s5 ?? 0;
  const exc = r?.exc ?? 0;
  const pct = (n: number) => (requests > 0 ? (n / requests) * 100 : 0);
  return {
    hours,
    requests,
    status4xx: r?.s4 ?? 0,
    status5xx: s5,
    exceptions: exc,
    errorRatePct: pct(s5 + exc),
    avgMs: requests > 0 ? (r?.dsum ?? 0) / requests : 0,
    maxMs: r?.dmax ?? 0,
    pctUnder300: pct(r?.under300 ?? 0),
    pctOver1s: pct(r?.over1s ?? 0),
  };
}

/** One calendar day (UTC) of platform health for the public status page. */
export interface DayHealth {
  day: string; // YYYY-MM-DD
  requests: number;
  status5xx: number;
  exceptions: number;
  /** 0–100: share of requests that were not 5xx/exception. */
  uptimePct: number;
}

/**
 * Daily rollup for the last `days` UTC days (default 90). Uptime =
 * 1 − (5xx+exceptions)/requests. Days with zero traffic report 100%.
 */
export async function getDailyHealth(env: Env, days = 90): Promise<DayHealth[]> {
  const hours = days * 24;
  const res = await env.DB.prepare(
    `SELECT substr(hour, 1, 10) AS day,
            COALESCE(SUM(requests), 0) AS requests,
            COALESCE(SUM(status_5xx), 0) AS s5,
            COALESCE(SUM(exceptions), 0) AS exc
     FROM health_metrics_hourly
     WHERE hour >= ?
     GROUP BY substr(hour, 1, 10)
     ORDER BY day ASC`
  )
    .bind(hourCutoff(hours))
    .all<{ day: string; requests: number; s5: number; exc: number }>();

  return (res.results ?? []).map((r) => {
    const requests = r.requests ?? 0;
    const bad = (r.s5 ?? 0) + (r.exc ?? 0);
    const uptimePct = requests > 0 ? Math.max(0, Math.min(100, ((requests - bad) / requests) * 100)) : 100;
    return {
      day: r.day,
      requests,
      status5xx: r.s5 ?? 0,
      exceptions: r.exc ?? 0,
      uptimePct,
    };
  });
}

export async function getRecentErrors(env: Env, limit = 50): Promise<ErrorRow[]> {
  const res = await env.DB.prepare(
    `SELECT id, created_at, status, outcome, method, route, path, request_id, message, country
     FROM ops_error_log ORDER BY created_at DESC LIMIT ?`
  )
    .bind(limit)
    .all<ErrorRow>();
  return res.results ?? [];
}

// Trim retained telemetry: errors kept 7 days, hourly rows kept 90 days.
export async function cleanupObservability(env: Env): Promise<{ errors: number; hours: number }> {
  const errCut = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const hourCut = hourCutoff(90 * 24);
  const e = await env.DB.prepare('DELETE FROM ops_error_log WHERE created_at < ?').bind(errCut).run();
  const h = await env.DB.prepare('DELETE FROM health_metrics_hourly WHERE hour < ?').bind(hourCut).run();
  await env.DB.prepare('DELETE FROM webhook_log WHERE created_at < ?').bind(errCut).run();
  return { errors: e.meta?.changes ?? 0, hours: h.meta?.changes ?? 0 };
}

// --- Webhook event log ---

export interface WebhookLogRow {
  id: string;
  created_at: string;
  source: string;
  type: string;
  outcome: string;
  detail: string | null;
  status_code: number;
}

export async function getRecentWebhooks(env: Env, limit = 20, source?: string): Promise<WebhookLogRow[]> {
  const res = source
    ? await env.DB.prepare('SELECT * FROM webhook_log WHERE source = ? ORDER BY created_at DESC LIMIT ?').bind(source, limit).all<WebhookLogRow>()
    : await env.DB.prepare('SELECT * FROM webhook_log ORDER BY created_at DESC LIMIT ?').bind(limit).all<WebhookLogRow>();
  return res.results ?? [];
}
