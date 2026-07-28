import type { Env } from '../types';
import {
  MICRO_USD,
  r2StorageCost,
  bytesToGb,
  storageCostFor,
  servingCostFor,
  automationCostFor,
} from './cf-pricing';
import { fetchCloudflareUsage, type CloudflareUsage } from './cloudflare';

const since = (days: number) => `-${days} days`;

// ---------------------------------------------------------------------------
// What this instance costs to run
// ---------------------------------------------------------------------------

export interface CostMetrics {
  periodDays: number;
  llmCostUsd: number; // what the instance pays model providers
  storageBytes: number;
  storageCostUsd: number; // prorated to period
  infra: CloudflareUsage;
  infraTotalUsd: number; // cloudflare ops + measured storage
  totalCostUsd: number;
  overBudget: Array<{ name: string; spentUsd: number; budgetUsd: number }>;
}

export async function getCostMetrics(env: Env, days: number): Promise<CostMetrics> {
  const [llm, storage, infra, overBudget] = await Promise.all([
    env.DB.prepare(
      `SELECT COALESCE(SUM(base_cost_micro_usd),0) AS base
       FROM agent_usage_events WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`
    ).bind(since(days)).first<{ base: number }>(),
    env.DB.prepare(
      `SELECT
         (SELECT COALESCE(SUM(size_bytes),0) FROM assets) +
         (SELECT COALESCE(SUM(size_bytes),0) FROM blobs) AS bytes`
    ).first<{ bytes: number }>(),
    fetchCloudflareUsage(env, days),
    env.DB.prepare(
      `SELECT COALESCE(w.name,'(workspace)') AS name, c.monthly_budget_micro_usd AS budget,
              COALESCE((SELECT SUM(e.base_cost_micro_usd) FROM agent_usage_events e
                        WHERE e.workspace_id = c.workspace_id
                          AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','start of month')),0) AS spent
       FROM workspace_llm_config c LEFT JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.monthly_budget_micro_usd IS NOT NULL
         AND COALESCE((SELECT SUM(e.base_cost_micro_usd) FROM agent_usage_events e
                       WHERE e.workspace_id = c.workspace_id
                         AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','start of month')),0) >= c.monthly_budget_micro_usd
       ORDER BY spent DESC LIMIT 10`
    ).all<{ name: string; budget: number; spent: number }>(),
  ]);

  const llmCostUsd = (llm?.base ?? 0) / MICRO_USD;
  const storageBytes = storage?.bytes ?? 0;
  const storageCostUsd = r2StorageCost(storageBytes) * (days / 30);
  const infraTotalUsd = (infra.available ? infra.totalUsd : 0) + storageCostUsd;

  return {
    periodDays: days,
    llmCostUsd,
    storageBytes,
    storageCostUsd,
    infra,
    infraTotalUsd,
    totalCostUsd: llmCostUsd + infraTotalUsd,
    overBudget: (overBudget.results || []).map((r) => ({
      name: r.name,
      spentUsd: r.spent / MICRO_USD,
      budgetUsd: r.budget / MICRO_USD,
    })),
  };
}

// ---------------------------------------------------------------------------
// Landing conversion funnel
// ---------------------------------------------------------------------------

export interface FunnelMetrics {
  periodDays: number;
  steps: Array<{ event: string; label: string; count: number; pct: number }>;
  conversionPct: number;
  submitDaily: Array<{ date: string; value: number }>;
}

const FUNNEL_STEPS: Array<{ event: string; label: string }> = [
  { event: 'view', label: 'Landing views' },
  { event: 'focus', label: 'Focused input' },
  { event: 'keystroke', label: 'Started typing' },
  { event: 'submit', label: 'Submitted' },
];

export async function getFunnelMetrics(env: Env, days: number): Promise<FunnelMetrics> {
  const [counts, daily] = await Promise.all([
    env.DB.prepare(
      `SELECT event, COUNT(*) AS n FROM funnel_events WHERE ts >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) GROUP BY event`
    ).bind(since(days)).all<{ event: string; n: number }>(),
    env.DB.prepare(
      `SELECT date(ts) AS date, COUNT(*) AS value FROM funnel_events
       WHERE event = 'submit' AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) GROUP BY date(ts) ORDER BY date`
    ).bind(since(days)).all<{ date: string; value: number }>(),
  ]);

  const byEvent: Record<string, number> = {};
  for (const r of counts.results || []) byEvent[r.event] = r.n;
  const views = byEvent['view'] || 0;

  const steps = FUNNEL_STEPS.map((s) => {
    const count = byEvent[s.event] || 0;
    return { event: s.event, label: s.label, count, pct: views > 0 ? (count / views) * 100 : 0 };
  });

  return {
    periodDays: days,
    steps,
    conversionPct: views > 0 ? ((byEvent['submit'] || 0) / views) * 100 : 0,
    submitDaily: daily.results || [],
  };
}

// ---------------------------------------------------------------------------
// Ops health — scheduled jobs
// ---------------------------------------------------------------------------

export interface OpsMetrics {
  totalJobs: number;
  enabledJobs: number;
  failingJobs: number;
  recentFailures: Array<{ artifact: string; action: string; error: string; when: number | null }>;
}

export async function getOpsMetrics(env: Env): Promise<OpsMetrics> {
  const [stats, failures] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(enabled),0) AS enabled,
              COALESCE(SUM(CASE WHEN last_status='failed' THEN 1 ELSE 0 END),0) AS failing
       FROM scheduled_jobs`
    ).first<{ total: number; enabled: number; failing: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(a.name, a.slug, j.artifact_id) AS artifact, j.action,
              COALESCE(j.last_error,'(no detail)') AS error, j.last_run_at AS when_ts
       FROM scheduled_jobs j LEFT JOIN artifacts a ON a.id = j.artifact_id
       WHERE j.last_status = 'failed' ORDER BY j.last_run_at DESC LIMIT 10`
    ).all<{ artifact: string; action: string; error: string; when_ts: number | null }>(),
  ]);

  return {
    totalJobs: stats?.total ?? 0,
    enabledJobs: stats?.enabled ?? 0,
    failingJobs: stats?.failing ?? 0,
    recentFailures: (failures.results || []).map((f) => ({
      artifact: f.artifact,
      action: f.action,
      error: f.error,
      when: f.when_ts,
    })),
  };
}

// ---------------------------------------------------------------------------
// Storage footprint
// ---------------------------------------------------------------------------

export interface StorageMetrics {
  totalBytes: number;
  totalGb: number;
  byType: Array<{ name: string; count: number }>; // bytes per artifact_type (count = bytes)
  topArtifacts: Array<{ name: string; slug: string; bytes: number }>;
}

export async function getStorageMetrics(env: Env): Promise<StorageMetrics> {
  const [total, byType, top] = await Promise.all([
    env.DB.prepare(
      `SELECT (SELECT COALESCE(SUM(size_bytes),0) FROM assets) +
              (SELECT COALESCE(SUM(size_bytes),0) FROM blobs) AS bytes`
    ).first<{ bytes: number }>(),
    env.DB.prepare(
      `SELECT a.artifact_type AS name, COALESCE(SUM(s.size_bytes),0) AS count
       FROM assets s
       JOIN versions v ON v.id = s.version_id
       JOIN artifacts a ON a.id = v.artifact_id
       GROUP BY a.artifact_type ORDER BY count DESC`
    ).all<{ name: string; count: number }>(),
    env.DB.prepare(
      `SELECT a.name, a.slug, (
         COALESCE((SELECT SUM(s.size_bytes) FROM assets s JOIN versions v ON v.id = s.version_id WHERE v.artifact_id = a.id),0) +
         COALESCE((SELECT SUM(b.size_bytes) FROM blobs b WHERE b.artifact_id = a.id),0)
       ) AS bytes
       FROM artifacts a ORDER BY bytes DESC LIMIT 10`
    ).all<{ name: string; slug: string; bytes: number }>(),
  ]);

  const totalBytes = total?.bytes ?? 0;
  return {
    totalBytes,
    totalGb: bytesToGb(totalBytes),
    byType: byType.results || [],
    topArtifacts: (top.results || []).filter((a) => a.bytes > 0),
  };
}

// ---------------------------------------------------------------------------
// Complete cost by workspace
// ---------------------------------------------------------------------------
// Cloudflare bills the account as a whole — there is no per-customer invoice —
// so per-workspace dollars are an ESTIMATE: each workspace's own measured usage
// (storage bytes, served requests, job runs, AI tokens) priced at Cloudflare's
// list rates, plus the real AI provider cost. Egress bytes are not yet tracked.

export interface WorkspaceCostRow {
  workspaceId: string | null;
  name: string;
  // raw usage
  storageBytes: number;
  servedRequests: number;
  jobRuns: number;
  jobCpuMs: number;
  tokens: number;
  // estimated USD per dimension
  storageUsd: number;
  servingUsd: number;
  automationUsd: number;
  aiUsd: number; // real provider cost
  totalUsd: number; // total cost
  // trend: change in operating cost (serving + automation + AI) over the last `days`
  // vs the prior equal window. Storage is point-in-time so it is held constant and
  // excluded from the delta. Positive = getting more expensive.
  costDeltaUsd: number;
}

export interface WorkspaceCosts {
  days: number;
  egressTracked: false; // not yet instrumented — surfaced in the UI
  rows: WorkspaceCostRow[];
  totals: WorkspaceCostRow;
}

// `sinceExpr` is a SQLite datetime modifier (e.g. '-7 days', 'start of month').
// `days` is the representative window length used to prorate monthly rates.
export async function getWorkspaceCosts(env: Env, sinceExpr: string, days: number): Promise<WorkspaceCosts> {
  // Rolling day windows for the trend comparison: last N days vs the N days before.
  const curWin = `-${days} days`;
  const prevWin = `-${days * 2} days`;
  const [workspaces, storage, serving, automation, ai, servingTrend, automationTrend, aiTrend] = await Promise.all([
    env.DB.prepare('SELECT id, COALESCE(name, slug, id) AS name FROM workspaces').all<{ id: string; name: string }>(),
    // Storage is a point-in-time footprint, not window-bound.
    env.DB.prepare(
      `SELECT a.workspace_id AS wid, COALESCE(SUM(x.sz),0) AS bytes
       FROM (
         SELECT v.artifact_id AS aid, s.size_bytes AS sz FROM assets s JOIN versions v ON v.id = s.version_id
         UNION ALL
         SELECT b.artifact_id AS aid, b.size_bytes AS sz FROM blobs b
       ) x JOIN artifacts a ON a.id = x.aid
       GROUP BY a.workspace_id`
    ).all<{ wid: string | null; bytes: number }>(),
    env.DB.prepare(
      `SELECT a.workspace_id AS wid, COUNT(*) AS n
       FROM analytics_events e JOIN artifacts a ON a.id = e.artifact_id
       WHERE e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
       GROUP BY a.workspace_id`
    ).bind(sinceExpr).all<{ wid: string | null; n: number }>(),
    env.DB.prepare(
      `SELECT a.workspace_id AS wid, COUNT(*) AS runs, COALESCE(SUM(l.duration_ms),0) AS cpums
       FROM job_runs l
       JOIN scheduled_jobs j ON j.id = l.job_id
       JOIN artifacts a ON a.id = j.artifact_id
       WHERE CAST(l.created_at AS INTEGER) >= unixepoch('now', ?)
       GROUP BY a.workspace_id`
    ).bind(sinceExpr).all<{ wid: string | null; runs: number; cpums: number }>(),
    env.DB.prepare(
      `SELECT workspace_id AS wid,
              COALESCE(SUM(base_cost_micro_usd),0) AS micro,
              COALESCE(SUM(input_tokens + output_tokens),0) AS tokens
       FROM agent_usage_events WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
       GROUP BY workspace_id`
    ).bind(sinceExpr).all<{ wid: string | null; micro: number; tokens: number }>(),
    // --- Trend windows (rolling N days vs prior N days) ---
    env.DB.prepare(
      `SELECT a.workspace_id AS wid,
              SUM(CASE WHEN e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1) THEN 1 ELSE 0 END) AS cur,
              SUM(CASE WHEN e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?2) AND e.created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1) THEN 1 ELSE 0 END) AS prev
       FROM analytics_events e JOIN artifacts a ON a.id = e.artifact_id
       WHERE e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?2)
       GROUP BY a.workspace_id`
    ).bind(curWin, prevWin).all<{ wid: string | null; cur: number; prev: number }>(),
    env.DB.prepare(
      `SELECT a.workspace_id AS wid,
              SUM(CASE WHEN CAST(l.created_at AS INTEGER) >= unixepoch('now', ?1) THEN 1 ELSE 0 END) AS cur_runs,
              COALESCE(SUM(CASE WHEN CAST(l.created_at AS INTEGER) >= unixepoch('now', ?1) THEN l.duration_ms ELSE 0 END),0) AS cur_cpu,
              SUM(CASE WHEN CAST(l.created_at AS INTEGER) >= unixepoch('now', ?2) AND CAST(l.created_at AS INTEGER) < unixepoch('now', ?1) THEN 1 ELSE 0 END) AS prev_runs,
              COALESCE(SUM(CASE WHEN CAST(l.created_at AS INTEGER) >= unixepoch('now', ?2) AND CAST(l.created_at AS INTEGER) < unixepoch('now', ?1) THEN l.duration_ms ELSE 0 END),0) AS prev_cpu
       FROM job_runs l JOIN scheduled_jobs j ON j.id = l.job_id JOIN artifacts a ON a.id = j.artifact_id
       WHERE CAST(l.created_at AS INTEGER) >= unixepoch('now', ?2)
       GROUP BY a.workspace_id`
    ).bind(curWin, prevWin).all<{ wid: string | null; cur_runs: number; cur_cpu: number; prev_runs: number; prev_cpu: number }>(),
    env.DB.prepare(
      `SELECT workspace_id AS wid,
              COALESCE(SUM(CASE WHEN created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1) THEN base_cost_micro_usd ELSE 0 END),0) AS cur_base,
              COALESCE(SUM(CASE WHEN created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?2) AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1) THEN base_cost_micro_usd ELSE 0 END),0) AS prev_base
       FROM agent_usage_events WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?2)
       GROUP BY workspace_id`
    ).bind(curWin, prevWin).all<{ wid: string | null; cur_base: number; prev_base: number }>(),
  ]);

  const PERSONAL = ' personal'; // sentinel key for workspace_id IS NULL
  const rows = new Map<string, WorkspaceCostRow>();
  const blank = (workspaceId: string | null, name: string): WorkspaceCostRow => ({
    workspaceId,
    name,
    storageBytes: 0,
    servedRequests: 0,
    jobRuns: 0,
    jobCpuMs: 0,
    tokens: 0,
    storageUsd: 0,
    servingUsd: 0,
    automationUsd: 0,
    aiUsd: 0,
    totalUsd: 0,
    costDeltaUsd: 0,
  });
  const keyOf = (wid: string | null) => wid ?? PERSONAL;
  const row = (wid: string | null): WorkspaceCostRow => {
    const k = keyOf(wid);
    let r = rows.get(k);
    if (!r) {
      r = blank(wid, wid ? wid : '(personal / no workspace)');
      rows.set(k, r);
    }
    return r;
  };

  for (const w of workspaces.results || []) row(w.id).name = w.name;
  for (const s of storage.results || []) {
    const r = row(s.wid);
    r.storageBytes = s.bytes;
    r.storageUsd = storageCostFor(s.bytes, days);
  }
  for (const s of serving.results || []) {
    const r = row(s.wid);
    r.servedRequests = s.n;
    r.servingUsd = servingCostFor(s.n);
  }
  for (const a of automation.results || []) {
    const r = row(a.wid);
    r.jobRuns = a.runs;
    r.jobCpuMs = a.cpums;
    r.automationUsd = automationCostFor(a.runs, a.cpums);
  }
  for (const a of ai.results || []) {
    const r = row(a.wid);
    r.tokens = a.tokens;
    r.aiUsd = a.micro / MICRO_USD;
  }

  // Operating cost (excl. storage) for an arbitrary window's components.
  const opCost = (baseMicro: number, reqs: number, runs: number, cpu: number) =>
    servingCostFor(reqs) + automationCostFor(runs, cpu) + baseMicro / MICRO_USD;
  const servTrend = new Map<string, { cur: number; prev: number }>();
  for (const s of servingTrend.results || []) servTrend.set(keyOf(s.wid), { cur: s.cur, prev: s.prev });
  const autoTrend = new Map<string, { cur_runs: number; cur_cpu: number; prev_runs: number; prev_cpu: number }>();
  for (const a of automationTrend.results || []) autoTrend.set(keyOf(a.wid), a);
  for (const a of aiTrend.results || []) {
    const r = row(a.wid);
    const k = keyOf(a.wid);
    const sv = servTrend.get(k) || { cur: 0, prev: 0 };
    const au = autoTrend.get(k) || { cur_runs: 0, cur_cpu: 0, prev_runs: 0, prev_cpu: 0 };
    const cur = opCost(a.cur_base, sv.cur, au.cur_runs, au.cur_cpu);
    const prev = opCost(a.prev_base, sv.prev, au.prev_runs, au.prev_cpu);
    r.costDeltaUsd = cur - prev;
  }
  // Workspaces with serving/automation activity but no AI rows still get a delta.
  for (const k of new Set<string>([...servTrend.keys(), ...autoTrend.keys()])) {
    const r = rows.get(k);
    if (!r || r.costDeltaUsd !== 0) continue;
    const sv = servTrend.get(k) || { cur: 0, prev: 0 };
    const au = autoTrend.get(k) || { cur_runs: 0, cur_cpu: 0, prev_runs: 0, prev_cpu: 0 };
    r.costDeltaUsd = opCost(0, sv.cur, au.cur_runs, au.cur_cpu) - opCost(0, sv.prev, au.prev_runs, au.prev_cpu);
  }

  const finalize = (r: WorkspaceCostRow) => {
    r.totalUsd = r.storageUsd + r.servingUsd + r.automationUsd + r.aiUsd;
  };

  const list = [...rows.values()];
  for (const r of list) finalize(r);
  list.sort((a, b) => b.totalUsd - a.totalUsd); // most expensive first — what needs attention

  const totals = blank(null, 'All workspaces');
  for (const r of list) {
    totals.storageBytes += r.storageBytes;
    totals.servedRequests += r.servedRequests;
    totals.jobRuns += r.jobRuns;
    totals.jobCpuMs += r.jobCpuMs;
    totals.tokens += r.tokens;
    totals.storageUsd += r.storageUsd;
    totals.servingUsd += r.servingUsd;
    totals.automationUsd += r.automationUsd;
    totals.aiUsd += r.aiUsd;
    totals.costDeltaUsd += r.costDeltaUsd;
  }
  finalize(totals);

  return { days, egressTracked: false, rows: list, totals };
}
