import type { Env } from '../types';

export interface NameCount {
  name: string;
  count: number;
}

export interface DayPoint {
  date: string;
  value: number;
}

export interface TopArtifact {
  id: string;
  name: string;
  slug: string;
  type: string;
  views: number;
}

export interface TokenModel {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface TokenWorkspace {
  name: string;
  costUsd: number;
  tokens: number;
}

export interface RecentArtifact {
  name: string;
  slug: string;
  type: string;
  visibility: string;
  owner: string;
  createdAt: string;
}

export interface Delta {
  value: number;
  pct: number | null; // null when there's no prior-period baseline
}

export interface PlatformMetrics {
  periodDays: number;
  totals: {
    artifacts: number;
    users: number;
    workspaces: number;
    activeUsers30d: number;
    views: number;
    uniqueVisitors: number;
    tokens: number;
    costUsd: number;
  };
  // Change within the selected window vs the immediately preceding window.
  deltas: {
    artifacts: Delta;
    users: Delta;
    views: Delta;
    tokens: Delta;
  };
  artifacts: {
    byType: NameCount[];
    byVisibility: NameCount[];
    createdDaily: DayPoint[];
    topByViews: TopArtifact[];
    recent: RecentArtifact[];
  };
  traffic: {
    viewsDaily: DayPoint[];
    visitorsDaily: DayPoint[];
    topCountries: NameCount[];
    topReferrers: NameCount[];
  };
  tokens: {
    byModel: TokenModel[];
    daily: DayPoint[];
    topWorkspaces: TokenWorkspace[];
  };
  usersGrowthDaily: DayPoint[];
}

const MICRO = 1_000_000;

export interface AiUsageMetrics {
  /** Total non-LLM AI calls in the window. */
  calls: number;
  /** Total audio minutes transcribed (Whisper). */
  audioMinutes: number;
  /** Tracked (not billed) cost in USD. */
  costUsd: number;
  /** Breakdown by kind+source, e.g. "whisper_transcribe · telegram". */
  byKind: NameCount[];
}

/**
 * Summarize the ai_usage_events ledger (Whisper today). Cost is tracking-only —
 * it is NOT debited from any workspace balance.
 */
export async function getAiUsageMetrics(env: Env, days: number): Promise<AiUsageMetrics> {
  const since = `-${days} days`;
  const [totals, byKind] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(CASE WHEN unit_kind = 'audio_seconds' THEN units ELSE 0 END), 0) AS seconds,
              COALESCE(SUM(base_cost_micro_usd), 0) AS cost
         FROM ai_usage_events WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`
    ).bind(since).first<{ calls: number; seconds: number; cost: number }>(),
    env.DB.prepare(
      `SELECT kind, source, COUNT(*) AS n
         FROM ai_usage_events WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
        GROUP BY kind, source ORDER BY n DESC LIMIT 10`
    ).bind(since).all<{ kind: string; source: string | null; n: number }>(),
  ]);
  return {
    calls: totals?.calls ?? 0,
    audioMinutes: Math.round(((totals?.seconds ?? 0) / 60) * 10) / 10,
    costUsd: (totals?.cost ?? 0) / MICRO,
    byKind: (byKind.results || []).map((r) => ({
      name: r.source ? `${r.kind} · ${r.source}` : r.kind,
      count: r.n,
    })),
  };
}

async function scalar(env: Env, sql: string): Promise<number> {
  const row = await env.DB.prepare(sql).first<{ n: number }>();
  return row?.n ?? 0;
}

// Merge the per-artifact JSON arrays (top_referrers / top_countries) stored on
// analytics_daily into a single platform-wide ranking.
function mergeJsonCounts(rows: Array<{ blob: string | null }>): NameCount[] {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.blob) continue;
    try {
      const parsed = JSON.parse(r.blob) as NameCount[];
      for (const item of parsed) {
        if (!item?.name) continue;
        counts[item.name] = (counts[item.name] || 0) + (item.count || 0);
      }
    } catch {
      /* ignore malformed json */
    }
  }
  return Object.entries(counts)
    .filter(([name]) => name && name !== 'XX' && name !== 'direct')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));
}

function pctChange(curr: number, prev: number): Delta {
  if (prev === 0) return { value: curr, pct: curr === 0 ? 0 : null };
  return { value: curr, pct: ((curr - prev) / prev) * 100 };
}

export async function getPlatformMetrics(env: Env, days = 30): Promise<PlatformMetrics> {
  const win = `-${days} days`;
  const prevWin = `-${days * 2} days`;
  const [
    artifactCount,
    userCount,
    workspaceCount,
    activeUsers,
    viewsAgg,
    tokenAgg,
    byType,
    byVisibility,
    createdDaily,
    topByViews,
    recent,
    viewsDaily,
    countryRows,
    referrerRows,
    tokenByModel,
    tokenDaily,
    tokenWorkspaces,
    usersGrowth,
    artifactsDelta,
    usersDelta,
    viewsDelta,
    tokensDelta,
  ] = await Promise.all([
    scalar(env, 'SELECT COUNT(*) AS n FROM artifacts'),
    scalar(env, 'SELECT COUNT(*) AS n FROM users'),
    scalar(env, 'SELECT COUNT(*) AS n FROM workspaces'),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE last_login_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)"
    ).bind(win).first<{ n: number }>(),
    env.DB.prepare(
      'SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(unique_visitors),0) AS visitors FROM analytics_daily'
    ).first<{ views: number; visitors: number }>(),
    env.DB.prepare(
      'SELECT COALESCE(SUM(input_tokens + output_tokens),0) AS tokens, COALESCE(SUM(base_cost_micro_usd),0) AS cost FROM agent_usage_events'
    ).first<{ tokens: number; cost: number }>(),
    env.DB.prepare(
      'SELECT artifact_type AS name, COUNT(*) AS count FROM artifacts GROUP BY artifact_type ORDER BY count DESC'
    ).all<NameCount>(),
    env.DB.prepare(
      'SELECT visibility AS name, COUNT(*) AS count FROM artifacts GROUP BY visibility ORDER BY count DESC'
    ).all<NameCount>(),
    env.DB.prepare(
      "SELECT date(created_at) AS date, COUNT(*) AS value FROM artifacts WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) GROUP BY date(created_at) ORDER BY date"
    ).bind(win).all<DayPoint>(),
    env.DB.prepare(
      `SELECT a.id, a.name, a.slug, a.artifact_type AS type, COALESCE(SUM(d.views),0) AS views
       FROM artifacts a
       JOIN analytics_daily d ON d.artifact_id = a.id
       GROUP BY a.id
       ORDER BY views DESC
       LIMIT 10`
    ).all<TopArtifact>(),
    env.DB.prepare(
      `SELECT a.name, a.slug, a.artifact_type AS type, a.visibility,
              COALESCE(u.email, u.name, 'unknown') AS owner, a.created_at AS createdAt
       FROM artifacts a
       LEFT JOIN users u ON u.id = a.owner_id
       ORDER BY a.created_at DESC
       LIMIT 12`
    ).all<RecentArtifact>(),
    env.DB.prepare(
      "SELECT date, SUM(views) AS value FROM analytics_daily WHERE date >= date('now', ?) GROUP BY date ORDER BY date"
    ).bind(win).all<DayPoint>(),
    env.DB.prepare(
      "SELECT top_countries AS blob FROM analytics_daily WHERE date >= date('now', ?)"
    ).bind(win).all<{ blob: string | null }>(),
    env.DB.prepare(
      "SELECT top_referrers AS blob FROM analytics_daily WHERE date >= date('now', ?)"
    ).bind(win).all<{ blob: string | null }>(),
    env.DB.prepare(
      `SELECT model, COALESCE(SUM(input_tokens),0) AS inputTokens,
              COALESCE(SUM(output_tokens),0) AS outputTokens,
              COALESCE(SUM(base_cost_micro_usd),0) AS costMicro
       FROM agent_usage_events GROUP BY model ORDER BY costMicro DESC LIMIT 10`
    ).all<{ model: string; inputTokens: number; outputTokens: number; costMicro: number }>(),
    env.DB.prepare(
      "SELECT date(created_at) AS date, SUM(input_tokens + output_tokens) AS value FROM agent_usage_events WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) GROUP BY date(created_at) ORDER BY date"
    ).bind(win).all<DayPoint>(),
    env.DB.prepare(
      `SELECT COALESCE(w.name, '(no workspace)') AS name,
              COALESCE(SUM(e.base_cost_micro_usd),0) AS costMicro,
              COALESCE(SUM(e.input_tokens + e.output_tokens),0) AS tokens
       FROM agent_usage_events e
       LEFT JOIN workspaces w ON w.id = e.workspace_id
       GROUP BY e.workspace_id ORDER BY costMicro DESC LIMIT 10`
    ).all<{ name: string; costMicro: number; tokens: number }>(),
    env.DB.prepare(
      "SELECT date(created_at) AS date, COUNT(*) AS value FROM users WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) GROUP BY date(created_at) ORDER BY date"
    ).bind(win).all<DayPoint>(),
    // Current vs previous window counts for trend deltas.
    env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1) THEN 1 ELSE 0 END),0) AS curr,
         COALESCE(SUM(CASE WHEN created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?2) AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1) THEN 1 ELSE 0 END),0) AS prev
       FROM artifacts`
    ).bind(win, prevWin).first<{ curr: number; prev: number }>(),
    env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1) THEN 1 ELSE 0 END),0) AS curr,
         COALESCE(SUM(CASE WHEN created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?2) AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1) THEN 1 ELSE 0 END),0) AS prev
       FROM users`
    ).bind(win, prevWin).first<{ curr: number; prev: number }>(),
    env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN date >= date('now', ?1) THEN views ELSE 0 END),0) AS curr,
         COALESCE(SUM(CASE WHEN date >= date('now', ?2) AND date < date('now', ?1) THEN views ELSE 0 END),0) AS prev
       FROM analytics_daily`
    ).bind(win, prevWin).first<{ curr: number; prev: number }>(),
    env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1) THEN input_tokens + output_tokens ELSE 0 END),0) AS curr,
         COALESCE(SUM(CASE WHEN created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?2) AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1) THEN input_tokens + output_tokens ELSE 0 END),0) AS prev
       FROM agent_usage_events`
    ).bind(win, prevWin).first<{ curr: number; prev: number }>(),
  ]);

  // Add today's not-yet-aggregated events to the view totals.
  const todayStart = Math.floor(new Date(new Date().toISOString().split('T')[0]).getTime() / 1000);
  const todayViews = await env.DB.prepare(
    "SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors FROM analytics_events WHERE event_type = 'view' AND created_at >= ?"
  ).bind(todayStart).first<{ views: number; visitors: number }>();

  return {
    periodDays: days,
    totals: {
      artifacts: artifactCount,
      users: userCount,
      workspaces: workspaceCount,
      activeUsers30d: activeUsers?.n ?? 0,
      views: (viewsAgg?.views ?? 0) + (todayViews?.views ?? 0),
      uniqueVisitors: (viewsAgg?.visitors ?? 0) + (todayViews?.visitors ?? 0),
      tokens: tokenAgg?.tokens ?? 0,
      costUsd: (tokenAgg?.cost ?? 0) / MICRO,
    },
    deltas: {
      artifacts: pctChange(artifactsDelta?.curr ?? 0, artifactsDelta?.prev ?? 0),
      users: pctChange(usersDelta?.curr ?? 0, usersDelta?.prev ?? 0),
      views: pctChange(viewsDelta?.curr ?? 0, viewsDelta?.prev ?? 0),
      tokens: pctChange(tokensDelta?.curr ?? 0, tokensDelta?.prev ?? 0),
    },
    artifacts: {
      byType: byType.results || [],
      byVisibility: byVisibility.results || [],
      createdDaily: createdDaily.results || [],
      topByViews: topByViews.results || [],
      recent: recent.results || [],
    },
    traffic: {
      viewsDaily: viewsDaily.results || [],
      visitorsDaily: [],
      topCountries: mergeJsonCounts(countryRows.results || []),
      topReferrers: mergeJsonCounts(referrerRows.results || []),
    },
    tokens: {
      byModel: (tokenByModel.results || []).map((m) => ({
        model: m.model,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        costUsd: m.costMicro / MICRO,
      })),
      daily: tokenDaily.results || [],
      topWorkspaces: (tokenWorkspaces.results || []).map((w) => ({
        name: w.name,
        costUsd: w.costMicro / MICRO,
        tokens: w.tokens,
      })),
    },
    usersGrowthDaily: usersGrowth.results || [],
  };
}
