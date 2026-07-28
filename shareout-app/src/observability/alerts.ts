import type { Env } from '../types';
import {
  notifySuperadmins,
  resolveSuperadminTelegramChatIds,
  superadminBotToken,
} from '../superadmin/recipients';
import { getWorkspaceCosts } from '../superadmin/insights';
import { sendMessage } from '../telegram/client';
import { countExceededMemoryKills } from './cf-worker-analytics';
import { getWindowSummary, type ErrorEvent } from './store';
import { getPlatformHostname, getPlatformOrigin } from '../config/origins';

const ALERT_PREFIX = 'obs:alert:';

function adminUrl(env: Env): string {
  const base = getPlatformOrigin(env);
  return `${base}/admin?view=health`;
}

/** @deprecated Use notifySuperadmins from superadmin/recipients. */
export const notifyAdmin = notifySuperadmins;

async function sendAdminMessage(env: Env, chatIds: number[], text: string): Promise<boolean> {
  if (chatIds.length === 0) return false;
  const token = superadminBotToken(env);
  let delivered = false;
  for (const chatId of chatIds) {
    try {
      await sendMessage(env, chatId, text, token);
      delivered = true;
    } catch {
      // try remaining recipients
    }
  }
  return delivered;
}

// Send a Telegram alert, deduped by `key` for `cooldownSec` so repeats are muted.
export async function fireAlert(env: Env, key: string, message: string, cooldownSec = 300): Promise<void> {
  try {
    if (env.RATE_LIMIT_KV) {
      const k = ALERT_PREFIX + key;
      if (await env.RATE_LIMIT_KV.get(k)) return; // still cooling down
      await env.RATE_LIMIT_KV.put(k, '1', { expirationTtl: cooldownSec }).catch(() => {});
    }
    const chatIds = await resolveSuperadminTelegramChatIds(env);
    if (chatIds.length === 0) return;
    await sendAdminMessage(env, chatIds, message);
  } catch {
    // alerting must never throw into the caller
  }
}

// Real-time alert for a single server error. Deduped per (outcome, route, class).
export async function alertOnError(env: Env, e: ErrorEvent): Promise<void> {
  const key = `${e.outcome}:${e.route || e.path || '?'}:${Math.floor(e.status / 100)}`;
  const title = e.outcome === 'exception' ? '💥 Unhandled exception' : `🔴 HTTP ${e.status}`;
  const lines = [
    `${title} · ${getPlatformHostname(env)}`,
    `${e.method || ''} ${e.path || e.route || ''}`.trim(),
    e.message ? `→ ${e.message.slice(0, 300)}` : '',
    e.requestId ? `ray: ${e.requestId}` : '',
    `(repeats muted 5m · ${adminUrl(env)})`,
  ].filter(Boolean);
  await fireAlert(env, key, lines.join('\n'), 300);
}

// Hourly: inspect the just-completed hour and alert if a threshold is breached.
// One alert per type per hour. Quiet when traffic is too low to be meaningful.
export async function runHealthSweep(env: Env): Promise<void> {
  const prevHour = new Date(Date.now() - 3_600_000).toISOString().slice(0, 13);
  const row = await env.DB.prepare(
    `SELECT requests, status_5xx, exceptions, b_le_3000, b_gt_3000
     FROM health_metrics_hourly WHERE hour = ?`
  )
    .bind(prevHour)
    .first<{ requests: number; status_5xx: number; exceptions: number; b_le_3000: number; b_gt_3000: number }>();
  if (!row || row.requests < 10) return;

  const over1s = row.b_le_3000 + row.b_gt_3000;
  const rate5xx = row.status_5xx / row.requests;
  const link = adminUrl(env);

  if (row.status_5xx >= 5 && rate5xx > 0.02) {
    await fireAlert(
      env,
      `sweep:5xx:${prevHour}`,
      `⚠️ Elevated 5xx · last hour\n${row.status_5xx} server errors / ${row.requests} reqs (${(rate5xx * 100).toFixed(1)}%)\n${link}`,
      3600
    );
  }
  if (row.exceptions >= 3) {
    await fireAlert(
      env,
      `sweep:exc:${prevHour}`,
      `⚠️ ${row.exceptions} unhandled exceptions · last hour (${row.requests} reqs)\n${link}`,
      3600
    );
  }
  if (row.requests >= 200 && over1s / row.requests > 0.15) {
    await fireAlert(
      env,
      `sweep:slow:${prevHour}`,
      `🐢 Slow responses · last hour\n${over1s}/${row.requests} requests took >1s (${((over1s / row.requests) * 100).toFixed(0)}%)\n${link}`,
      3600
    );
  }

  // Cron isolate kills (exceededMemory) never hit observe() — poll CF Analytics when configured.
  const hourStart = new Date(`${prevHour}:00:00.000Z`);
  const memoryKills = await countExceededMemoryKills(env, hourStart).catch(() => null);
  if (memoryKills && memoryKills > 0) {
    await fireAlert(
      env,
      `sweep:memory:${prevHour}`,
      `💥 Worker memory limit exceeded · last hour\n${memoryKills} isolate kill(s) (exceededMemory — invisible to D1 telemetry)\n${link}`,
      3600
    );
  }
}

// Once-daily 24h rollup digest (sent from the cron at a fixed UTC hour).
export async function sendDailySummary(env: Env): Promise<void> {
  const w = await getWindowSummary(env, 24);
  const day = new Date().toISOString().slice(0, 10);
  const health = w.status5xx + w.exceptions === 0 ? '✅' : '⚠️';
  const msg = [
    `${health} Daily health · ${day} (24h)`,
    `Requests: ${w.requests.toLocaleString('en-US')}`,
    `Errors: ${w.status5xx} 5xx · ${w.exceptions} exceptions · ${w.status4xx} 4xx`,
    `Error rate: ${w.errorRatePct.toFixed(2)}%`,
    `Latency: ${Math.round(w.avgMs)}ms avg · ${w.maxMs}ms max · ${w.pctUnder300.toFixed(0)}% under 300ms`,
    adminUrl(env),
  ].join('\n');
  await fireAlert(env, `daily:${day}`, msg, 86_400);
}

function costAlertThresholdUsd(env: Env): number {
  const n = Number(env.COST_ALERT_THRESHOLD_USD);
  return Number.isFinite(n) && n > 0 ? n : 1.0;
}

// Once-daily per-workspace cost digest: surfaces workspaces whose 30-day estimated
// cost exceeds the threshold, so a runaway workspace doesn't go
// unnoticed. Quiet when nothing crosses the bar. Sent from the cron at a fixed hour.
export async function sendWorkspaceCostDigest(env: Env): Promise<void> {
  const threshold = costAlertThresholdUsd(env);
  let costs;
  try {
    costs = await getWorkspaceCosts(env, '-30 days', 30);
  } catch {
    return; // never break the cron on a reporting query
  }

  const expensive = costs.rows
    .filter((r) => r.totalUsd >= threshold)
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, 8);

  if (expensive.length === 0) return; // nothing noteworthy

  const day = new Date().toISOString().slice(0, 10);
  const fmtUsd = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
  const base = getPlatformOrigin(env);
  const lines = [
    `💸 Most expensive workspaces · ${day} (30d)`,
    `${fmtUsd(costs.totals.totalUsd)} total · ${expensive.length} over $${threshold.toFixed(2)}`,
    ...expensive.map(
      (r) => `• ${r.name}: ${fmtUsd(r.totalUsd)} (AI ${fmtUsd(r.aiUsd)} · storage ${fmtUsd(r.storageUsd)})`
    ),
    `${base}/admin?view=workspace-costs&range=30`,
  ];
  await fireAlert(env, `wscost:${day}`, lines.join('\n'), 86_400);
}
