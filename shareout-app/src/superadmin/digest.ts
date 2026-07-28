import type { Env } from '../types';
import { fetchCloudflareUsage } from './cloudflare';

const MICRO = 1_000_000;

export interface FunnelFlow {
  name: string;
  steps: Array<{ event: string; label: string; count: number; pctOfViews: number }>;
  views: number;
  uniqueSessions: number;
  conversionPct: number;
}

export interface ExecutiveSignal {
  level: 'highlight' | 'warn' | 'info';
  message: string;
}

export interface DailyPlatformDigest {
  reportDate: string;
  generatedAt: string;
  growth: {
    newArtifacts: number;
    newUsers: number;
    newWorkspaces: number;
    newWorkspaceMembers: number;
    versionPublishes: number;
    logins: number;
    activeUsers30d: number;
  };
  totals: {
    artifacts: number;
    users: number;
    workspaces: number;
  };
  vsPriorDay: {
    newArtifacts: number;
    newUsers: number;
    logins: number;
    landingViews: number;
    artifactViews: number;
  };
  marketing: {
    uniqueSessions: number;
    personal: FunnelFlow;
    teams: FunnelFlow;
    agents: { copySkill: number; sectionViews: number };
    topCountries: Array<{ country: string; count: number }>;
    topStarterChips: Array<{ label: string; count: number }>;
  };
  productUsage: {
    artifactViews: number;
    uniqueVisitors: number;
    crewRuns: number;
    scheduledJobsExecuted: number;
    topArtifacts: Array<{ name: string; slug: string; workspace: string; views: number }>;
  };
  workspaces: {
    active: Array<{
      name: string;
      slug: string;
      newMembers: number;
      publishes: number;
      logins: number;
      aiTokens: number;
    }>;
    newToday: Array<{ name: string; slug: string; createdAt: string }>;
  };
  economics: {
    aiTokens: number;
    aiCostUsd: number;
    aiRevenueUsd: number;
    outstandingBalanceUsd: number;
    cloudflareUsd: number;
    cloudflareAvailable: boolean;
    totalSpendUsd: number;
    tokenByWorkspace: Array<{ name: string; tokens: number; costUsd: number }>;
    mtd: {
      aiCostUsd: number;
      cloudflareUsd: number;
      cloudflareAvailable: boolean;
      totalSpendUsd: number;
    };
  };
  health: {
    requests: number;
    status5xx: number;
    exceptions: number;
    status4xx: number;
    errorRatePct: number;
    avgMs: number;
  };
  signals: ExecutiveSignal[];
  newArtifacts: Array<{
    name: string;
    slug: string;
    type: string;
    visibility: string;
    owner: string;
    createdAt: string;
  }>;
  newUsers: Array<{ email: string; name: string; createdAt: string }>;
  workspaceMembers: Array<{ workspace: string; email: string; role: string; createdAt: string }>;
  publishes: Array<{ name: string; slug: string; versionNo: number; createdAt: string }>;
  recentErrors: Array<{ ts: string; status: number; route: string | null; message: string | null }>;
}

const PERSONAL_STEPS: Array<{ event: string; label: string }> = [
  { event: 'view', label: 'Landing views' },
  { event: 'focus', label: 'Focused prompt' },
  { event: 'keystroke', label: 'Started typing' },
  { event: 'chip', label: 'Used starter chip' },
  { event: 'submit', label: 'Submitted idea' },
];

const TEAMS_STEPS: Array<{ event: string; label: string }> = [
  { event: 'teams_focus', label: 'Teams prompt focus' },
  { event: 'teams_keystroke', label: 'Teams typing' },
  { event: 'teams_contact', label: 'Contact CTA' },
  { event: 'teams_plan_select', label: 'Plan selected' },
];

/** Calendar day for the digest. Defaults to yesterday (UTC). */
export function defaultReportDate(d = new Date()): string {
  const y = new Date(d);
  y.setUTCDate(y.getUTCDate() - 1);
  return y.toISOString().slice(0, 10);
}

function dayStartUnix(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00.000Z`).getTime() / 1000);
}

function dayEndUnix(date: string): number {
  return dayStartUnix(date) + 86_400;
}

async function scalarOnDay(
  env: Env,
  table: string,
  dateCol: string,
  date: string,
  extra = ''
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE date(${dateCol}) = ?${extra}`
  )
    .bind(date)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function buildFunnelFlow(
  name: string,
  steps: Array<{ event: string; label: string }>,
  byEvent: Record<string, number>,
  views: number,
  sessions: number
): FunnelFlow {
  const mapped = steps.map((s) => {
    const count = byEvent[s.event] ?? 0;
    return { event: s.event, label: s.label, count, pctOfViews: views > 0 ? (count / views) * 100 : 0 };
  });
  const last = steps[steps.length - 1];
  const conv = last ? byEvent[last.event] ?? 0 : 0;
  return {
    name,
    steps: mapped,
    views,
    uniqueSessions: sessions,
    conversionPct: views > 0 ? (conv / views) * 100 : 0,
  };
}

function buildSignals(d: Omit<DailyPlatformDigest, 'signals'>): ExecutiveSignal[] {
  const out: ExecutiveSignal[] = [];
  const { growth, vsPriorDay, marketing, health, economics } = d;

  if (growth.newUsers > 0 && growth.newUsers >= vsPriorDay.newUsers * 2 && vsPriorDay.newUsers > 0) {
    out.push({ level: 'highlight', message: `User signups spiked: ${growth.newUsers} vs ${vsPriorDay.newUsers} prior day` });
  } else if (growth.newUsers > 0) {
    out.push({ level: 'info', message: `${growth.newUsers} new user(s) signed up` });
  }

  if (growth.newWorkspaceMembers >= 3) {
    out.push({ level: 'highlight', message: `${growth.newWorkspaceMembers} workspace invites accepted — team expansion day` });
  }

  if (marketing.personal.views > 0 && marketing.personal.conversionPct < 1 && marketing.personal.views >= 10) {
    out.push({ level: 'warn', message: `Landing conversion low: ${marketing.personal.conversionPct.toFixed(1)}% submit rate` });
  }

  if (health.errorRatePct > 1) {
    out.push({ level: 'warn', message: `Platform error rate ${health.errorRatePct.toFixed(2)}% — check errors section` });
  }

  if (economics.aiRevenueUsd > 0) {
    out.push({ level: 'info', message: `AI revenue $${economics.aiRevenueUsd.toFixed(2)} yesterday` });
  }

  if (growth.versionPublishes >= 5) {
    out.push({ level: 'highlight', message: `Heavy publishing day: ${growth.versionPublishes} version deploys` });
  }

  return out;
}

/** Executive platform metrics for one calendar day (UTC). */
export async function getDailyPlatformDigest(
  env: Env,
  reportDate = defaultReportDate()
): Promise<DailyPlatformDigest> {
  const prior = new Date(`${reportDate}T12:00:00.000Z`);
  prior.setUTCDate(prior.getUTCDate() - 1);
  const priorDate = prior.toISOString().slice(0, 10);
  const hourPrefix = `${reportDate}T`;
  const dayStart = dayStartUnix(reportDate);
  const dayEnd = dayEndUnix(reportDate);
  // Month-to-date window: first of the report month through the report day (inclusive).
  const monthStart = `${reportDate.slice(0, 7)}-01`;
  const daysElapsed = parseInt(reportDate.slice(8, 10), 10) || 1;

  const [
    totals,
    growthScalars,
    vsPriorScalars,
    activeUsers30d,
    healthRow,
    aiRow,
    balanceRow,
    funnelRows,
    funnelSessions,
    funnelCountries,
    funnelChips,
    newArtifacts,
    newUsers,
    workspaceMembers,
    newWorkspaces,
    workspaceActivity,
    publishes,
    recentErrors,
    trafficRollup,
    trafficLive,
    topArtifactsRollup,
    topArtifactsLive,
    crewRuns,
    jobRuns,
    cloudflareUsage,
    mtdAiRow,
    tokenByWorkspaceRows,
    cloudflareMtd,
  ] = await Promise.all([
    Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM artifacts').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM workspaces').first<{ n: number }>(),
    ]),
    Promise.all([
      scalarOnDay(env, 'artifacts', 'created_at', reportDate),
      scalarOnDay(env, 'users', 'created_at', reportDate),
      scalarOnDay(env, 'workspaces', 'created_at', reportDate),
      scalarOnDay(env, 'workspace_members', 'created_at', reportDate),
      scalarOnDay(env, 'versions', 'created_at', reportDate),
      scalarOnDay(env, 'users', 'last_login_at', reportDate),
    ]),
    Promise.all([
      scalarOnDay(env, 'artifacts', 'created_at', priorDate),
      scalarOnDay(env, 'users', 'created_at', priorDate),
      scalarOnDay(env, 'users', 'last_login_at', priorDate),
      scalarOnDay(env, 'funnel_events', 'ts', priorDate, " AND event = 'view'"),
      env.DB.prepare(
        `SELECT COALESCE(SUM(views),0) AS v FROM analytics_daily WHERE date = ?`
      )
        .bind(priorDate)
        .first<{ v: number }>(),
    ]),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE last_login_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-30 days')"
    ).first<{ n: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(requests),0) AS requests,
              COALESCE(SUM(status_5xx),0) AS s5,
              COALESCE(SUM(exceptions),0) AS exc,
              COALESCE(SUM(status_4xx),0) AS s4,
              COALESCE(SUM(dur_sum_ms),0) AS dsum
       FROM health_metrics_hourly WHERE hour LIKE ? || '%'`
    )
      .bind(hourPrefix)
      .first<{ requests: number; s5: number; exc: number; s4: number; dsum: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens),0) AS tokens,
              COALESCE(SUM(base_cost_micro_usd),0) AS cost,
              COALESCE(SUM(billed_cost_micro_usd),0) AS revenue,
              COUNT(*) AS events
       FROM agent_usage_events WHERE date(created_at) = ?`
    )
      .bind(reportDate)
      .first<{ tokens: number; cost: number; revenue: number; events: number }>(),
    env.DB.prepare(
      'SELECT COALESCE(SUM(balance_micro_usd),0) AS bal FROM workspace_llm_config'
    ).first<{ bal: number }>(),
    env.DB.prepare(
      `SELECT event, COUNT(*) AS count FROM funnel_events WHERE date(created_at) = ? GROUP BY event`
    )
      .bind(reportDate)
      .all<{ event: string; count: number }>(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT sid) AS sessions FROM funnel_events WHERE date(created_at) = ? AND sid IS NOT NULL`
    )
      .bind(reportDate)
      .first<{ sessions: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(country, 'XX') AS country, COUNT(*) AS count
       FROM funnel_events WHERE date(ts) = ? AND event = 'view'
       GROUP BY country ORDER BY count DESC LIMIT 8`
    )
      .bind(reportDate)
      .all<{ country: string; count: number }>(),
    env.DB.prepare(
      `SELECT label, COUNT(*) AS count FROM funnel_events
       WHERE date(ts) = ? AND event = 'chip' AND label IS NOT NULL
       GROUP BY label ORDER BY count DESC LIMIT 8`
    )
      .bind(reportDate)
      .all<{ label: string; count: number }>(),
    env.DB.prepare(
      `SELECT a.name, a.slug, a.artifact_type AS type, a.visibility,
              COALESCE(u.email, u.name, 'unknown') AS owner, a.created_at AS createdAt
       FROM artifacts a LEFT JOIN users u ON u.id = a.owner_id
       WHERE date(a.created_at) = ? ORDER BY a.created_at DESC`
    )
      .bind(reportDate)
      .all<DailyPlatformDigest['newArtifacts'][0]>(),
    env.DB.prepare(
      `SELECT email, name, created_at AS createdAt FROM users
       WHERE date(created_at) = ? ORDER BY created_at DESC`
    )
      .bind(reportDate)
      .all<{ email: string; name: string; createdAt: string }>(),
    env.DB.prepare(
      `SELECT COALESCE(w.name, '(workspace)') AS workspace, u.email, wm.role, wm.created_at AS createdAt
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       JOIN users u ON u.id = wm.user_id
       WHERE date(wm.created_at) = ? ORDER BY wm.created_at DESC`
    )
      .bind(reportDate)
      .all<DailyPlatformDigest['workspaceMembers'][0]>(),
    env.DB.prepare(
      `SELECT name, slug, created_at AS createdAt FROM workspaces
       WHERE date(created_at) = ? ORDER BY created_at DESC`
    )
      .bind(reportDate)
      .all<{ name: string; slug: string; createdAt: string }>(),
    env.DB.prepare(
      `SELECT w.name, w.slug,
              (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id AND date(wm.created_at) = ?1) AS newMembers,
              (SELECT COUNT(*) FROM versions v JOIN artifacts a ON a.id = v.artifact_id
               WHERE a.workspace_id = w.id AND date(v.created_at) = ?1) AS publishes,
              (SELECT COUNT(DISTINCT u.id) FROM users u JOIN workspace_members wm ON wm.user_id = u.id
               WHERE wm.workspace_id = w.id AND date(u.last_login_at) = ?1) AS logins,
              (SELECT COALESCE(SUM(e.input_tokens + e.output_tokens),0) FROM agent_usage_events e
               WHERE e.workspace_id = w.id AND date(e.created_at) = ?1) AS aiTokens
       FROM workspaces w
       WHERE (
         (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id AND date(wm.created_at) = ?1) > 0
         OR (SELECT COUNT(*) FROM versions v JOIN artifacts a ON a.id = v.artifact_id
             WHERE a.workspace_id = w.id AND date(v.created_at) = ?1) > 0
         OR (SELECT COUNT(DISTINCT u.id) FROM users u JOIN workspace_members wm ON wm.user_id = u.id
             WHERE wm.workspace_id = w.id AND date(u.last_login_at) = ?1) > 0
         OR (SELECT COALESCE(SUM(e.input_tokens + e.output_tokens),0) FROM agent_usage_events e
             WHERE e.workspace_id = w.id AND date(e.created_at) = ?1) > 0
       )
       ORDER BY publishes DESC, newMembers DESC, logins DESC LIMIT 12`
    )
      .bind(reportDate)
      .all<DailyPlatformDigest['workspaces']['active'][0]>(),
    env.DB.prepare(
      `SELECT a.name, a.slug, v.version_no AS versionNo, v.created_at AS createdAt
       FROM versions v JOIN artifacts a ON a.id = v.artifact_id
       WHERE date(v.created_at) = ? ORDER BY v.created_at DESC LIMIT 20`
    )
      .bind(reportDate)
      .all<DailyPlatformDigest['publishes'][0]>(),
    env.DB.prepare(
      `SELECT ts, status, route, substr(message, 1, 200) AS message
       FROM ops_error_log WHERE date(ts) = ? ORDER BY ts DESC LIMIT 8`
    )
      .bind(reportDate)
      .all<DailyPlatformDigest['recentErrors'][0]>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(unique_visitors),0) AS visitors
       FROM analytics_daily WHERE date = ?`
    )
      .bind(reportDate)
      .first<{ views: number; visitors: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
       FROM analytics_events
       WHERE event_type = 'view' AND created_at >= ? AND created_at < ?`
    )
      .bind(dayStart, dayEnd)
      .first<{ views: number; visitors: number }>(),
    env.DB.prepare(
      `SELECT a.name, a.slug, COALESCE(w.name, '') AS workspace, d.views
       FROM analytics_daily d
       JOIN artifacts a ON a.id = d.artifact_id
       LEFT JOIN workspaces w ON w.id = a.workspace_id
       WHERE d.date = ? ORDER BY d.views DESC LIMIT 8`
    )
      .bind(reportDate)
      .all<{ name: string; slug: string; workspace: string; views: number }>(),
    env.DB.prepare(
      `SELECT a.name, a.slug, '' AS workspace, COUNT(*) AS views
       FROM analytics_events e JOIN artifacts a ON a.id = e.artifact_id
       WHERE e.event_type = 'view' AND e.created_at >= ? AND e.created_at < ?
       GROUP BY a.id ORDER BY views DESC LIMIT 8`
    )
      .bind(dayStart, dayEnd)
      .all<{ name: string; slug: string; workspace: string; views: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM crew_runs WHERE date(started_at) = ?`
    )
      .bind(reportDate)
      .first<{ n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM scheduled_jobs WHERE date(last_run_at) = ? AND last_status = 'success'`
    )
      .bind(reportDate)
      .first<{ n: number }>(),
    // Cloudflare infra spend for the report day (estimate). Defensive: returns
    // { available:false, totalUsd:0 } on any config/API error so the digest still renders.
    fetchCloudflareUsage(env, 1, { since: reportDate, until: reportDate }).catch(() => null),
    // Month-to-date token cost (first of month through report day).
    env.DB.prepare(
      `SELECT COALESCE(SUM(base_cost_micro_usd),0) AS cost
       FROM agent_usage_events WHERE date(created_at) >= ? AND date(created_at) <= ?`
    )
      .bind(monthStart, reportDate)
      .first<{ cost: number }>(),
    // Per-workspace token spend for the report day (top consumers).
    env.DB.prepare(
      `SELECT COALESCE(w.name, 'Personal') AS name,
              COALESCE(SUM(e.input_tokens + e.output_tokens),0) AS tokens,
              COALESCE(SUM(e.base_cost_micro_usd),0) AS costMicro
       FROM agent_usage_events e
       LEFT JOIN workspaces w ON w.id = e.workspace_id
       WHERE date(e.created_at) = ?
       GROUP BY e.workspace_id ORDER BY costMicro DESC LIMIT 8`
    )
      .bind(reportDate)
      .all<{ name: string; tokens: number; costMicro: number }>(),
    // Cloudflare infra spend month-to-date (proration window = days elapsed).
    fetchCloudflareUsage(env, daysElapsed, { since: monthStart, until: reportDate }).catch(() => null),
  ]);

  const byEvent: Record<string, number> = {};
  for (const r of funnelRows.results ?? []) byEvent[r.event] = r.count;

  const personalViews = byEvent['view'] ?? 0;
  const sessions = funnelSessions?.sessions ?? 0;
  const rollupViews = trafficRollup?.views ?? 0;
  const liveViews = trafficLive?.views ?? 0;
  const artifactViews = rollupViews > 0 ? rollupViews : liveViews;
  const requests = healthRow?.requests ?? 0;
  const s5 = healthRow?.s5 ?? 0;
  const exc = healthRow?.exc ?? 0;

  const topArtifacts =
    (topArtifactsRollup.results?.length ?? 0) > 0
      ? topArtifactsRollup.results ?? []
      : topArtifactsLive.results ?? [];

  const partial: Omit<DailyPlatformDigest, 'signals'> = {
    reportDate,
    generatedAt: new Date().toISOString(),
    growth: {
      newArtifacts: growthScalars[0],
      newUsers: growthScalars[1],
      newWorkspaces: growthScalars[2],
      newWorkspaceMembers: growthScalars[3],
      versionPublishes: growthScalars[4],
      logins: growthScalars[5],
      activeUsers30d: activeUsers30d?.n ?? 0,
    },
    totals: {
      artifacts: totals[0]?.n ?? 0,
      users: totals[1]?.n ?? 0,
      workspaces: totals[2]?.n ?? 0,
    },
    vsPriorDay: {
      newArtifacts: vsPriorScalars[0],
      newUsers: vsPriorScalars[1],
      logins: vsPriorScalars[2],
      landingViews: vsPriorScalars[3],
      artifactViews: vsPriorScalars[4]?.v ?? 0,
    },
    marketing: {
      uniqueSessions: sessions,
      personal: buildFunnelFlow('Personal landing', PERSONAL_STEPS, byEvent, personalViews, sessions),
      teams: buildFunnelFlow('Teams landing', TEAMS_STEPS, byEvent, byEvent['teams_focus'] ?? 0, sessions),
      agents: {
        sectionViews: byEvent['agents_section'] ?? 0,
        copySkill: byEvent['agents_copy_skill'] ?? 0,
      },
      topCountries: funnelCountries.results ?? [],
      topStarterChips: funnelChips.results ?? [],
    },
    productUsage: {
      artifactViews,
      uniqueVisitors:
        (trafficRollup?.visitors ?? 0) > 0 ? (trafficRollup?.visitors ?? 0) : (trafficLive?.visitors ?? 0),
      crewRuns: crewRuns?.n ?? 0,
      scheduledJobsExecuted: jobRuns?.n ?? 0,
      topArtifacts,
    },
    workspaces: {
      active: workspaceActivity.results ?? [],
      newToday: newWorkspaces.results ?? [],
    },
    economics: {
      aiTokens: aiRow?.tokens ?? 0,
      aiCostUsd: (aiRow?.cost ?? 0) / MICRO,
      aiRevenueUsd: (aiRow?.revenue ?? 0) / MICRO,
      outstandingBalanceUsd: (balanceRow?.bal ?? 0) / MICRO,
      cloudflareUsd: cloudflareUsage?.available ? cloudflareUsage.totalUsd : 0,
      cloudflareAvailable: cloudflareUsage?.available ?? false,
      totalSpendUsd:
        (aiRow?.cost ?? 0) / MICRO + (cloudflareUsage?.available ? cloudflareUsage.totalUsd : 0),
      tokenByWorkspace: (tokenByWorkspaceRows.results ?? []).map((r) => ({
        name: r.name,
        tokens: r.tokens,
        costUsd: r.costMicro / MICRO,
      })),
      mtd: {
        aiCostUsd: (mtdAiRow?.cost ?? 0) / MICRO,
        cloudflareUsd: cloudflareMtd?.available ? cloudflareMtd.totalUsd : 0,
        cloudflareAvailable: cloudflareMtd?.available ?? false,
        totalSpendUsd:
          (mtdAiRow?.cost ?? 0) / MICRO + (cloudflareMtd?.available ? cloudflareMtd.totalUsd : 0),
      },
    },
    health: {
      requests,
      status5xx: s5,
      exceptions: exc,
      status4xx: healthRow?.s4 ?? 0,
      errorRatePct: requests > 0 ? ((s5 + exc) / requests) * 100 : 0,
      avgMs: requests > 0 ? (healthRow?.dsum ?? 0) / requests : 0,
    },
    newArtifacts: newArtifacts.results ?? [],
    newUsers: newUsers.results ?? [],
    workspaceMembers: workspaceMembers.results ?? [],
    publishes: publishes.results ?? [],
    recentErrors: recentErrors.results ?? [],
  };

  return { ...partial, signals: buildSignals(partial) };
}
