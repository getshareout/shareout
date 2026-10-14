// Daily per-workspace usage ledger (workspace_usage_daily): what each workspace cost the
// instance, per UTC day, per metric — the history an operator needs to see daily and
// monthly usage, and on a hosted instance to invoice from.
//
// Email sends and browser seconds are counted live, where they happen. Everything else
// is rolled up nightly from the tables that already record it. Storage is measured by
// listing R2 itself, so every write path counts — drafts, thumbnails, inbox mail,
// connection caches — not only the assets/datasets/blobs columns the quota gate sums.
//
// Cost is Cloudflare list price (or the real AI provider cost), marginal: the free
// allowances are account-wide, so they are not split across workspaces here.

import type { Env } from '../types';
import { CF_PRICING, BYTES_PER_GB, MICRO_USD } from '../superadmin/cf-pricing';
import { createLogger } from '../logging';

export const USAGE_METRICS = [
  'storage_bytes',
  'serving_requests',
  'job_runs',
  'job_duration_ms',
  'ai_llm_tokens',
  'ai_other_events',
  'email_sent',
  'browser_seconds',
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

const MAX_LIST_PAGES = 2000; // 2M objects; past that the measurement is logged as truncated

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function nextDay(day: string): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000));
}

export function daysInMonth(day: string): number {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const perMillion = (n: number, rate: number) => (n / 1_000_000) * rate;

/** List-price cost in micro-USD for `quantity` of a priced metric on `day`.
 *  AI metrics carry their real provider cost and are not priced here. */
export function costMicroUsd(metric: UsageMetric, quantity: number, day: string): number {
  const usd = (() => {
    switch (metric) {
      case 'storage_bytes':
        return (quantity / BYTES_PER_GB) * CF_PRICING.r2StoragePerGbMonth / daysInMonth(day);
      case 'serving_requests':
        return perMillion(quantity, CF_PRICING.workersPerMillionRequests + CF_PRICING.r2ClassBPerMillion);
      case 'job_runs':
        return perMillion(quantity, CF_PRICING.workersPerMillionRequests);
      case 'job_duration_ms':
        return perMillion(quantity, CF_PRICING.workersPerMillionCpuMs);
      case 'email_sent':
        return (quantity / 1000) * CF_PRICING.emailPerThousand;
      case 'browser_seconds':
        return (quantity / 3600) * CF_PRICING.browserPerHour;
      default:
        return 0;
    }
  })();
  return Math.round(usd * MICRO_USD);
}

/** Who owns an R2 key, from its layout. null = instance overhead (vendor cache, agent
 *  media, …). Thumbnails are `<artifactId>[_card].<ext>`, logos `<workspaceId>.<ext>`. */
export function r2KeyOwner(key: string): { artifactId: string } | { workspaceId: string } | { connectionId: string } | null {
  const [head, second = ''] = key.split('/');
  const stripExt = (s: string) => s.replace(/\.[A-Za-z0-9]+$/, '');
  switch (head) {
    case 'inbox':
    case 'uploads':
      return second ? { artifactId: second } : null;
    case 'thumbnails':
      return second ? { artifactId: stripExt(second).replace(/_card$/, '') } : null;
    case 'workspace-logos':
      return second ? { workspaceId: stripExt(second) } : null;
    case 'cache':
      return second ? { connectionId: second } : null;
    default:
      return head.startsWith('art_') ? { artifactId: head } : null;
  }
}

/** Bytes stored in R2 per workspace, right now. Soft-deleted artifacts and personal
 *  (no-workspace) artifacts land in `unattributedBytes`. */
export async function measureR2Storage(env: Env): Promise<{
  byWorkspace: Map<string, number>;
  unattributedBytes: number;
  objects: number;
  truncated: boolean;
}> {
  const [arts, conns] = await Promise.all([
    env.DB.prepare('SELECT id, workspace_id FROM artifacts WHERE deleted_at IS NULL')
      .all<{ id: string; workspace_id: string | null }>(),
    env.DB.prepare('SELECT id, scope_type, scope_id FROM connections')
      .all<{ id: string; scope_type: string; scope_id: string }>(),
  ]);
  const artifactWs = new Map((arts.results ?? []).map((a) => [a.id, a.workspace_id]));
  const connectionWs = new Map(
    (conns.results ?? []).map((c) => [c.id, c.scope_type === 'workspace' ? c.scope_id : artifactWs.get(c.scope_id) ?? null])
  );

  const byWorkspace = new Map<string, number>();
  let unattributedBytes = 0;
  let objects = 0;
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await env.ARTIFACTS.list({ cursor, limit: 1000 });
    for (const obj of page.objects) {
      objects++;
      const owner = r2KeyOwner(obj.key);
      const ws = !owner
        ? null
        : 'workspaceId' in owner
          ? owner.workspaceId
          : 'artifactId' in owner
            ? artifactWs.get(owner.artifactId) ?? null
            : connectionWs.get(owner.connectionId) ?? null;
      if (ws) byWorkspace.set(ws, (byWorkspace.get(ws) ?? 0) + obj.size);
      else unattributedBytes += obj.size;
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages++;
  } while (cursor && pages < MAX_LIST_PAGES);

  return { byWorkspace, unattributedBytes, objects, truncated: Boolean(cursor) };
}

const UPSERT_ADD = `
  INSERT INTO workspace_usage_daily (day, workspace_id, metric, quantity, cost_micro_usd)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(day, workspace_id, metric) DO UPDATE SET
    quantity = quantity + excluded.quantity,
    cost_micro_usd = cost_micro_usd + excluded.cost_micro_usd,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

const UPSERT_SET = `
  INSERT INTO workspace_usage_daily (day, workspace_id, metric, quantity, cost_micro_usd)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(day, workspace_id, metric) DO UPDATE SET
    quantity = excluded.quantity,
    cost_micro_usd = excluded.cost_micro_usd,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

/** Count live usage caused by an artifact against its workspace's row for today.
 *  Personal (no-workspace) artifacts are not metered. Callers swallow errors — metering
 *  must never fail the send or render it measures. */
export async function recordArtifactUsage(
  env: Env,
  artifactId: string,
  metric: 'email_sent' | 'browser_seconds',
  quantity: number
): Promise<void> {
  if (!(quantity > 0)) return;
  const row = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  if (!row?.workspace_id) return;
  const day = utcDay();
  await env.DB.prepare(UPSERT_ADD)
    .bind(day, row.workspace_id, metric, quantity, costMicroUsd(metric, quantity, day))
    .run();
}

/** Browser seconds since `startedAt`, rounded up, recorded against the artifact. */
export function recordBrowserSince(env: Env, artifactId: string, startedAt: number): Promise<void> {
  const seconds = Math.ceil((Date.now() - startedAt) / 1000);
  return recordArtifactUsage(env, artifactId, 'browser_seconds', seconds).catch(() => {});
}

/**
 * Roll up one UTC day into workspace_usage_daily. Idempotent: rerunning a day overwrites
 * its rolled-up metrics and leaves the live ones (email, browser) alone. Storage can only
 * be measured as of now, so pass `measureStorage` only for the day that just ended.
 */
export async function rollupWorkspaceUsage(
  env: Env,
  day: string,
  opts: { measureStorage: boolean }
): Promise<{ day: string; rows: number; unattributedBytes: number; truncated: boolean }> {
  const logger = createLogger(env, { scope: 'usage-ledger', event: 'daily_rollup' });
  const start = `${day}T00:00:00.000Z`;
  const end = `${nextDay(day)}T00:00:00.000Z`;
  const startSec = Date.parse(start) / 1000;
  const endSec = Date.parse(end) / 1000;

  const [workspaces, serving, jobs, llm, aiOther] = await Promise.all([
    env.DB.prepare('SELECT id FROM workspaces').all<{ id: string }>(),
    env.DB.prepare(
      `SELECT a.workspace_id AS wid, COUNT(*) AS n
         FROM analytics_events e JOIN artifacts a ON a.id = e.artifact_id
        WHERE e.created_at >= ? AND e.created_at < ? AND a.workspace_id IS NOT NULL
        GROUP BY a.workspace_id`
    ).bind(start, end).all<{ wid: string; n: number }>(),
    // job_runs.created_at is a unix-seconds scheduler cursor (see CONVENTIONS.md).
    env.DB.prepare(
      `SELECT a.workspace_id AS wid, COUNT(*) AS runs, COALESCE(SUM(l.duration_ms), 0) AS ms
         FROM job_runs l
         JOIN scheduled_jobs j ON j.id = l.job_id
         JOIN artifacts a ON a.id = j.artifact_id
        WHERE CAST(l.created_at AS INTEGER) >= ? AND CAST(l.created_at AS INTEGER) < ?
          AND a.workspace_id IS NOT NULL
        GROUP BY a.workspace_id`
    ).bind(startSec, endSec).all<{ wid: string; runs: number; ms: number }>(),
    // BYO-key calls are paid by the workspace's own provider account, so they cost us nothing.
    env.DB.prepare(
      `SELECT workspace_id AS wid, COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COALESCE(SUM(billed_cost_micro_usd), 0) AS micro
         FROM agent_usage_events
        WHERE created_at >= ? AND created_at < ? AND workspace_id IS NOT NULL AND byo = 0
        GROUP BY workspace_id`
    ).bind(start, end).all<{ wid: string; tokens: number; micro: number }>(),
    env.DB.prepare(
      `SELECT workspace_id AS wid, COUNT(*) AS n, COALESCE(SUM(base_cost_micro_usd), 0) AS micro
         FROM ai_usage_events
        WHERE created_at >= ? AND created_at < ? AND workspace_id IS NOT NULL
        GROUP BY workspace_id`
    ).bind(start, end).all<{ wid: string; n: number; micro: number }>(),
  ]);

  const known = new Set((workspaces.results ?? []).map((w) => w.id));
  const rows: Array<[string, UsageMetric, number, number]> = [];
  const add = (wid: string, metric: UsageMetric, quantity: number, cost = costMicroUsd(metric, quantity, day)) => {
    if (known.has(wid) && quantity > 0) rows.push([wid, metric, quantity, cost]);
  };

  for (const r of serving.results ?? []) add(r.wid, 'serving_requests', r.n);
  for (const r of jobs.results ?? []) {
    add(r.wid, 'job_runs', r.runs);
    add(r.wid, 'job_duration_ms', r.ms);
  }
  for (const r of llm.results ?? []) add(r.wid, 'ai_llm_tokens', r.tokens, r.micro);
  for (const r of aiOther.results ?? []) add(r.wid, 'ai_other_events', r.n, r.micro);

  let unattributedBytes = 0;
  let truncated = false;
  if (opts.measureStorage) {
    const storage = await measureR2Storage(env);
    for (const [wid, bytes] of storage.byWorkspace) add(wid, 'storage_bytes', bytes);
    unattributedBytes = storage.unattributedBytes;
    truncated = storage.truncated;
    if (truncated) logger.warn('r2 listing truncated; storage under-counted', { day, objects: storage.objects });
  }

  for (let i = 0; i < rows.length; i += 50) {
    await env.DB.batch(
      rows.slice(i, i + 50).map(([wid, metric, quantity, cost]) =>
        env.DB.prepare(UPSERT_SET).bind(day, wid, metric, quantity, cost)
      )
    );
  }

  logger.info('usage rollup done', { day, rows: rows.length, unattributed_bytes: unattributedBytes });
  return { day, rows: rows.length, unattributedBytes, truncated };
}

export interface MonthlyUsageRow {
  workspaceId: string;
  name: string;
  metric: UsageMetric;
  quantity: number; // sum over the month; storage is byte-days
  costMicroUsd: number;
}

/** First and one-past-last day of a YYYY-MM month. */
export function monthBounds(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  return { from, to: utcDay(new Date(Date.UTC(y, m, 1))) };
}

export async function getMonthlyUsage(env: Env, month: string): Promise<MonthlyUsageRow[]> {
  const { from, to } = monthBounds(month);
  const { results } = await env.DB.prepare(
    `SELECT u.workspace_id AS workspaceId, COALESCE(w.name, w.slug, u.workspace_id) AS name, u.metric AS metric,
            SUM(u.quantity) AS quantity, SUM(u.cost_micro_usd) AS costMicroUsd
       FROM workspace_usage_daily u JOIN workspaces w ON w.id = u.workspace_id
      WHERE u.day >= ? AND u.day < ?
      GROUP BY u.workspace_id, u.metric`
  ).bind(from, to).all<MonthlyUsageRow>();
  return results ?? [];
}

export interface DailyUsageRow {
  day: string;
  workspaceId: string;
  name: string;
  metric: UsageMetric;
  quantity: number;
  costMicroUsd: number;
}

export async function getDailyUsage(env: Env, month: string): Promise<DailyUsageRow[]> {
  const { from, to } = monthBounds(month);
  const { results } = await env.DB.prepare(
    `SELECT u.day AS day, u.workspace_id AS workspaceId, COALESCE(w.name, w.slug, u.workspace_id) AS name,
            u.metric AS metric, u.quantity AS quantity, u.cost_micro_usd AS costMicroUsd
       FROM workspace_usage_daily u JOIN workspaces w ON w.id = u.workspace_id
      WHERE u.day >= ? AND u.day < ?
      ORDER BY u.day, name, u.metric`
  ).bind(from, to).all<DailyUsageRow>();
  return results ?? [];
}

/** GB-months for a month's summed storage byte-days — the unit R2 bills in. */
export function gbMonths(byteDays: number, month: string): number {
  return byteDays / BYTES_PER_GB / daysInMonth(`${month}-01`);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const usd = (micro: number) => (micro / MICRO_USD).toFixed(6);

/** Invoice-ready CSV. Monthly storage is reported as `storage_gb_month`. */
export function usageCsv(month: string, monthly: MonthlyUsageRow[]): string {
  const lines = ['month,workspace_id,workspace,metric,quantity,cost_usd'];
  for (const r of monthly) {
    const storage = r.metric === 'storage_bytes';
    lines.push([
      month,
      r.workspaceId,
      r.name,
      storage ? 'storage_gb_month' : r.metric,
      storage ? gbMonths(r.quantity, month).toFixed(6) : r.quantity,
      usd(r.costMicroUsd),
    ].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

export function dailyUsageCsv(daily: DailyUsageRow[]): string {
  const lines = ['day,workspace_id,workspace,metric,quantity,cost_usd'];
  for (const r of daily) {
    lines.push([r.day, r.workspaceId, r.name, r.metric, r.quantity, usd(r.costMicroUsd)].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

/** YYYY-MM of the month before `d` (UTC) — the one you invoice. */
export function previousMonth(d = new Date()): string {
  return utcDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))).slice(0, 7);
}
