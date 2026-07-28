import type { Env } from '../types';
import { getWindowSummary } from '../observability/store';

export interface AdminPulse {
  generatedAt: string;
  users: { total: number; signupsToday: number; signupsYesterday: number; active30d: number };
  artifacts: { total: number; newToday: number };
  workspaces: { total: number };
  traffic: { viewsToday: number };
  ai: { revenueTodayUsd: number; tokensToday: number };
  health24h: { requests: number; status5xx: number; exceptions: number; errorRatePct: number; avgMs: number };
}

function utcDate(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function countOnDay(env: Env, table: string, col: string, date: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE date(${col}) = ?`
  )
    .bind(date)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Compact, fast platform snapshot for the admin Telegram /stats command. D1-only, no external calls. */
export async function getAdminPulse(env: Env): Promise<AdminPulse> {
  const today = utcDate(0);
  const yesterday = utcDate(-1);

  const [
    usersTotal,
    artifactsTotal,
    workspacesTotal,
    signupsToday,
    signupsYesterday,
    newArtifactsToday,
    active30d,
    viewsRow,
    aiRow,
    health24h,
  ] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM artifacts').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM workspaces').first<{ n: number }>(),
    countOnDay(env, 'users', 'created_at', today),
    countOnDay(env, 'users', 'created_at', yesterday),
    countOnDay(env, 'artifacts', 'created_at', today),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE last_login_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-30 days')"
    ).first<{ n: number }>(),
    env.DB.prepare('SELECT COALESCE(SUM(views),0) AS v FROM analytics_daily WHERE date = ?')
      .bind(today)
      .first<{ v: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens),0) AS tokens,
              COALESCE(SUM(billed_cost_micro_usd),0) AS revenue
       FROM agent_usage_events WHERE date(created_at) = ?`
    )
      .bind(today)
      .first<{ tokens: number; revenue: number }>(),
    getWindowSummary(env, 24),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    users: {
      total: usersTotal?.n ?? 0,
      signupsToday,
      signupsYesterday,
      active30d: active30d?.n ?? 0,
    },
    artifacts: { total: artifactsTotal?.n ?? 0, newToday: newArtifactsToday },
    workspaces: { total: workspacesTotal?.n ?? 0 },
    traffic: { viewsToday: viewsRow?.v ?? 0 },
    ai: {
      revenueTodayUsd: (aiRow?.revenue ?? 0) / 1_000_000,
      tokensToday: aiRow?.tokens ?? 0,
    },
    health24h: {
      requests: health24h.requests,
      status5xx: health24h.status5xx,
      exceptions: health24h.exceptions,
      errorRatePct: Number(health24h.errorRatePct.toFixed(2)),
      avgMs: Math.round(health24h.avgMs),
    },
  };
}

export interface AnalystContext {
  pulse: AdminPulse;
  signups7d: number;
  signups30d: number;
  newArtifacts7d: number;
  revenue30dUsd: number;
  recentSignups: { email: string; name: string | null; createdAt: string }[];
  topWorkspaces30d: { name: string; revenueUsd: number; tokens: number }[];
  recentErrors: { ts: string; route: string | null; message: string | null }[];
}

/** Richer business snapshot for the AI analyst (D1-only, on-demand). */
export async function getAnalystContext(env: Env): Promise<AnalystContext> {
  const [
    pulse,
    s7,
    s30,
    a7,
    rev30,
    recentSignups,
    topWs,
    recentErrors,
  ] = await Promise.all([
    getAdminPulse(env),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')").first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')").first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')").first<{ n: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(billed_cost_micro_usd),0) AS m FROM agent_usage_events WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')").first<{ m: number }>(),
    env.DB.prepare("SELECT email, name, created_at AS createdAt FROM users ORDER BY created_at DESC LIMIT 10").all<{ email: string; name: string | null; createdAt: string }>(),
    env.DB.prepare(
      `SELECT COALESCE(w.name,'(workspace)') AS name,
              COALESCE(SUM(e.billed_cost_micro_usd),0) AS rev,
              COALESCE(SUM(e.input_tokens + e.output_tokens),0) AS tokens
       FROM agent_usage_events e JOIN workspaces w ON w.id = e.workspace_id
       WHERE e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')
       GROUP BY e.workspace_id ORDER BY rev DESC LIMIT 5`
    ).all<{ name: string; rev: number; tokens: number }>(),
    env.DB.prepare(
      "SELECT ts, route, substr(message,1,160) AS message FROM ops_error_log ORDER BY ts DESC LIMIT 5"
    ).all<{ ts: string; route: string | null; message: string | null }>(),
  ]);

  return {
    pulse,
    signups7d: s7?.n ?? 0,
    signups30d: s30?.n ?? 0,
    newArtifacts7d: a7?.n ?? 0,
    revenue30dUsd: (rev30?.m ?? 0) / 1_000_000,
    recentSignups: recentSignups.results ?? [],
    topWorkspaces30d: (topWs.results ?? []).map((w) => ({ name: w.name, revenueUsd: w.rev / 1_000_000, tokens: w.tokens })),
    recentErrors: recentErrors.results ?? [],
  };
}

export interface AdminEvent { type: string; ts: number; text: string }

/** New noteworthy events since a unix-seconds watermark, for the proactive feed. */
export async function getAdminEvents(env: Env, sinceUnix: number): Promise<{ events: AdminEvent[]; now: number }> {
  const now = Math.floor(Date.now() / 1000);
  const since = sinceUnix > 0 ? sinceUnix : now - 3600; // first run: last hour only
  // The watermark stays unix seconds (it is this endpoint's public contract); the
  // columns are TEXT ISO-8601, so compare in that format.
  const sinceIso = new Date(since * 1000).toISOString();

  const [signups, errors] = await Promise.all([
    env.DB.prepare(
      `SELECT email, strftime('%s', created_at) AS ts FROM users
       WHERE created_at > ? ORDER BY created_at ASC LIMIT 25`
    ).bind(sinceIso).all<{ email: string; ts: string }>(),
    env.DB.prepare(
      `SELECT route, substr(message,1,120) AS message, strftime('%s', created_at) AS t FROM ops_error_log
       WHERE created_at > ? AND status >= 500 ORDER BY created_at ASC LIMIT 10`
    ).bind(sinceIso).all<{ route: string | null; message: string | null; t: string }>(),
  ]);

  const events: AdminEvent[] = [];
  for (const s of signups.results ?? []) {
    events.push({ type: 'signup', ts: Number(s.ts) || now, text: `🎉 New signup: ${s.email}` });
  }
  for (const e of errors.results ?? []) {
    events.push({ type: 'error', ts: Number(e.t) || now, text: `⚠️ 5xx on ${e.route || '?'}: ${e.message || ''}`.trim() });
  }
  events.sort((a, b) => a.ts - b.ts);
  return { events, now };
}
