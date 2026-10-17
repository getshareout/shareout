import type { Env } from '../types';
import { getPlatformOrigin } from '../config/origins';
import { isSuperAdminEmail } from '../superadmin/recipients';

// One workspace's weekly picture — activity AND usefulness — for a crew to narrate and
// mail to the workspace's admins. Read-only, scoped to exactly one workspace id, every
// query batched. Numbers come from real tables only; anything a table cannot answer is
// left out and explained in `notes`.

const DAY_MS = 86400_000;
const LIST = 10;
const MAX_DAYS = 31;

export type DigestPeriodKind = 'last_days' | 'previous_week';

export interface DigestOptions {
  days?: number;
  compare?: boolean;
  period?: DigestPeriodKind;
  tzOffsetMinutes?: number;
  now?: number;
}

export interface Window {
  from: string;
  to: string;
  days: number;
}

export interface DigestPeriod extends Window {
  kind: DigestPeriodKind;
  tzOffsetMinutes: number;
  previous: Window | null;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Period bounds, half-open [from, to). `previous_week` is the last full Monday→Monday
 *  calendar week in the given UTC offset; `last_days` ends now. */
export function resolveDigestPeriod(opts: DigestOptions = {}): DigestPeriod {
  const now = opts.now ?? Date.now();
  const tz = Math.max(-840, Math.min(840, Math.trunc(Number(opts.tzOffsetMinutes) || 0)));
  const kind: DigestPeriodKind = opts.period === 'previous_week' ? 'previous_week' : 'last_days';
  const compare = opts.compare !== false;
  let fromMs: number;
  let toMs: number;
  let days: number;
  if (kind === 'previous_week') {
    const local = now + tz * 60_000;
    const localMidnight = Math.floor(local / DAY_MS) * DAY_MS;
    const mondayIndex = (new Date(localMidnight).getUTCDay() + 6) % 7;
    const thisMondayUtc = localMidnight - mondayIndex * DAY_MS - tz * 60_000;
    days = 7;
    toMs = thisMondayUtc;
    fromMs = toMs - 7 * DAY_MS;
  } else {
    const n = Math.trunc(Number(opts.days));
    days = Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_DAYS) : 7;
    toMs = now;
    fromMs = now - days * DAY_MS;
  }
  return {
    kind,
    tzOffsetMinutes: tz,
    from: iso(fromMs),
    to: iso(toMs),
    days,
    previous: compare ? { from: iso(fromMs - days * DAY_MS), to: iso(fromMs), days } : null,
  };
}

/** The crew owner must be an internal owner/admin of the workspace, its owner of record,
 *  or an instance super-admin. Returns an error string when not. */
export async function checkDigestAccess(env: Env, workspaceId: string, userId: string): Promise<string | null> {
  if (!workspaceId) return 'This tool needs an artifact that belongs to a workspace.';
  const [member, ws, user] = await env.DB.batch([
    env.DB.prepare(
      `SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND member_class = 'internal' AND role IN ('owner','admin')`,
    ).bind(workspaceId, userId),
    env.DB.prepare(`SELECT owner_id FROM workspaces WHERE id = ?`).bind(workspaceId),
    env.DB.prepare(`SELECT email, disabled FROM users WHERE id = ?`).bind(userId),
  ]);
  const wsRow = ws.results[0] as { owner_id: string } | undefined;
  if (!wsRow) return 'Workspace not found.';
  const u = user.results[0] as { email: string | null; disabled: number } | undefined;
  if (!u || u.disabled) return 'Only workspace owners and admins can read workspace metrics.';
  if (member.results.length || wsRow.owner_id === userId || isSuperAdminEmail(u.email, env)) return null;
  return 'Only workspace owners and admins can read workspace metrics.';
}

// ── SQL ──────────────────────────────────────────────────────────────────────
// Every period query uses the same positional params so one helper binds them:
//   ?1 workspace id · ?2 from ISO · ?3 to ISO · ?4 rollup-from date · ?5 rollup-to date
//   ?6 from unix seconds · ?7 to unix seconds (job_runs.created_at is unix seconds)

const WS_ARTS = `(SELECT id FROM artifacts WHERE workspace_id = ?1)`;

// Views per artifact in the window. Finalised days come from analytics_daily (raw events
// are pruned ~2 days after their day is aggregated); days not yet finalised are counted
// live from analytics_events. `visitor_days` sums daily-unique visitors — visitor hashes
// rotate daily, so cross-day unique people are not derivable from anonymous views.
const VIEWS_BY_ARTIFACT = `
  SELECT artifact_id, SUM(v) AS views, SUM(u) AS visitor_days FROM (
    SELECT ad.artifact_id, ad.views AS v, ad.unique_visitors AS u
      FROM analytics_daily ad JOIN analytics_agg_state s ON s.date = ad.date
     WHERE ad.date >= ?4 AND ad.date < ?5 AND ad.artifact_id IN ${WS_ARTS}
    UNION ALL
    SELECT e.artifact_id, COUNT(*) AS v, COUNT(DISTINCT e.visitor_hash) AS u
      FROM analytics_events e
     WHERE e.event_type = 'view' AND e.created_at >= ?2 AND e.created_at < ?3
       AND e.artifact_id IN ${WS_ARTS}
       AND date(e.created_at) NOT IN (SELECT date FROM analytics_agg_state)
     GROUP BY e.artifact_id, date(e.created_at)
  ) GROUP BY artifact_id`;

// Identified views (signed-in viewers; the owner's own views are never recorded).
const VVE = `SELECT v.artifact_id, lower(v.email) AS email FROM viewer_view_events v
  WHERE v.artifact_id IN ${WS_ARTS} AND v.viewed_at >= ?2 AND v.viewed_at < ?3`;

const INTERNAL = `(SELECT lower(u.email) FROM workspace_members m JOIN users u ON u.id = m.user_id
  WHERE m.workspace_id = ?1 AND m.member_class = 'internal' AND u.email IS NOT NULL)`;

const PERIOD_SQL = {
  artifactsCreated: `SELECT COUNT(*) AS n FROM artifacts WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3`,
  artifactsDeleted: `SELECT COUNT(*) AS n FROM artifacts WHERE workspace_id = ?1 AND deleted_at >= ?2 AND deleted_at < ?3`,
  artifactsLive: `SELECT COUNT(*) AS n FROM artifacts WHERE workspace_id = ?1 AND created_at < ?3 AND (deleted_at IS NULL OR deleted_at >= ?3)`,
  versionsCreated: `SELECT COUNT(*) AS n, COUNT(DISTINCT artifact_id) AS artifacts FROM versions
    WHERE artifact_id IN ${WS_ARTS} AND created_at >= ?2 AND created_at < ?3`,
  deploysMoved: `SELECT COUNT(*) AS n FROM deployments
    WHERE channel = 'production' AND artifact_id IN ${WS_ARTS} AND updated_at >= ?2 AND updated_at < ?3`,
  newArtifacts: `SELECT a.id, a.name, a.artifact_type, COALESCE(d.slug, a.slug) AS slug, u.name AS creator_name, u.email AS creator_email
    FROM artifacts a LEFT JOIN users u ON u.id = a.owner_id
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    WHERE a.workspace_id = ?1 AND a.deleted_at IS NULL AND a.created_at >= ?2 AND a.created_at < ?3
    ORDER BY a.created_at DESC LIMIT ${LIST}`,
  viewsByArtifact: `SELECT x.artifact_id, x.views, x.visitor_days, a.name, COALESCE(d.slug, a.slug) AS slug,
      (SELECT COUNT(DISTINCT lower(v.email)) FROM viewer_view_events v
        WHERE v.artifact_id = x.artifact_id AND v.viewed_at >= ?2 AND v.viewed_at < ?3) AS identified_viewers
    FROM (${VIEWS_BY_ARTIFACT}) x JOIN artifacts a ON a.id = x.artifact_id
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    ORDER BY x.views DESC LIMIT 200`,
  identifiedViewers: `SELECT v.email, COUNT(*) AS views, COUNT(DISTINCT v.artifact_id) AS artifacts,
      CASE WHEN v.email IN ${INTERNAL} THEN 1 ELSE 0 END AS internal
    FROM (${VVE}) v GROUP BY v.email ORDER BY views DESC`,
  viewedByOthers: `SELECT COUNT(DISTINCT v.artifact_id) AS n FROM (${VVE}) v
    JOIN artifacts a ON a.id = v.artifact_id LEFT JOIN users o ON o.id = a.owner_id
    WHERE o.email IS NULL OR lower(o.email) <> v.email`,
  members: `SELECT u.id, u.name, lower(u.email) AS email, m.role, m.member_class, m.created_at
    FROM workspace_members m JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = ?1 AND m.created_at < ?3`,
  creatorsByUser: `SELECT owner_id AS user_id, COUNT(*) AS n FROM artifacts
    WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND owner_id IS NOT NULL GROUP BY owner_id`,
  versionsByUser: `SELECT COALESCE(v.created_by, a.owner_id) AS user_id, COUNT(*) AS n
    FROM versions v JOIN artifacts a ON a.id = v.artifact_id
    WHERE a.workspace_id = ?1 AND v.created_at >= ?2 AND v.created_at < ?3 GROUP BY 1`,
  aiByKind: `SELECT kind, unit_kind, SUM(units) AS units, SUM(base_cost_micro_usd) AS cost, COUNT(*) AS events
    FROM ai_usage_events WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3
    GROUP BY kind, unit_kind ORDER BY cost DESC`,
  aiByUser: `SELECT user_id, SUM(CASE WHEN unit_kind LIKE 'tokens%' THEN units ELSE 0 END) AS tokens, SUM(base_cost_micro_usd) AS cost
    FROM ai_usage_events WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND user_id IS NOT NULL GROUP BY user_id`,
  agentByMode: `SELECT mode, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
      SUM(base_cost_micro_usd) AS cost, COUNT(*) AS calls
    FROM agent_usage_events WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3
    GROUP BY mode ORDER BY cost DESC`,
  agentByUser: `SELECT COALESCE(c.owner_id, t.user_id) AS user_id,
      SUM(e.input_tokens) AS input_tokens, SUM(e.output_tokens) AS output_tokens, SUM(e.base_cost_micro_usd) AS cost
    FROM agent_usage_events e
    LEFT JOIN crews c ON c.id = e.crew_id
    LEFT JOIN agent_threads t ON t.id = e.conversation_id
    WHERE e.workspace_id = ?1 AND e.created_at >= ?2 AND e.created_at < ?3
    GROUP BY 1`,
  agentByArtifact: `SELECT e.artifact_id, a.name, SUM(e.input_tokens + e.output_tokens) AS tokens, SUM(e.base_cost_micro_usd) AS cost
    FROM agent_usage_events e JOIN artifacts a ON a.id = e.artifact_id
    WHERE e.workspace_id = ?1 AND e.created_at >= ?2 AND e.created_at < ?3
    GROUP BY e.artifact_id ORDER BY cost DESC LIMIT ${LIST}`,
  jobsByStatus: `SELECT r.status, COUNT(*) AS n FROM job_runs r JOIN scheduled_jobs j ON j.id = r.job_id
    WHERE j.artifact_id IN ${WS_ARTS} AND CAST(r.created_at AS INTEGER) >= ?6 AND CAST(r.created_at AS INTEGER) < ?7
    GROUP BY r.status`,
  jobFailures: `SELECT COALESCE(j.title, j.action) AS job, j.action, a.name AS artifact, substr(r.error, 1, 200) AS error,
      CAST(r.created_at AS INTEGER) AS at, COUNT(*) OVER (PARTITION BY j.id) AS failures
    FROM job_runs r JOIN scheduled_jobs j ON j.id = r.job_id JOIN artifacts a ON a.id = j.artifact_id
    WHERE a.workspace_id = ?1 AND r.status = 'failed'
      AND CAST(r.created_at AS INTEGER) >= ?6 AND CAST(r.created_at AS INTEGER) < ?7
    ORDER BY CAST(r.created_at AS INTEGER) DESC LIMIT 50`,
  crewRuns: `SELECT status, COUNT(*) AS n, SUM(token_input) AS input_tokens, SUM(token_output) AS output_tokens, SUM(cost_micro_usd) AS cost
    FROM crew_runs WHERE artifact_id IN ${WS_ARTS} AND started_at >= ?2 AND started_at < ?3 GROUP BY status`,
  comments: `SELECT
      SUM(CASE WHEN created_at >= ?2 AND created_at < ?3 THEN 1 ELSE 0 END) AS created,
      SUM(CASE WHEN created_at >= ?2 AND created_at < ?3 AND parent_id IS NULL THEN 1 ELSE 0 END) AS threads,
      SUM(CASE WHEN created_at >= ?2 AND created_at < ?3 AND author_type = 'agent' THEN 1 ELSE 0 END) AS by_agents,
      SUM(CASE WHEN created_at >= ?2 AND created_at < ?3 AND author_type = 'guest' THEN 1 ELSE 0 END) AS by_guests,
      SUM(CASE WHEN resolved_at >= ?2 AND resolved_at < ?3 THEN 1 ELSE 0 END) AS resolved,
      SUM(CASE WHEN assignee_email IS NOT NULL AND created_at >= ?2 AND created_at < ?3 THEN 1 ELSE 0 END) AS action_items_created,
      SUM(CASE WHEN assignee_email IS NOT NULL AND resolved_at >= ?2 AND resolved_at < ?3 THEN 1 ELSE 0 END) AS action_items_done,
      SUM(CASE WHEN assignee_email IS NOT NULL AND created_at < ?3 AND (resolved = 0 OR resolved_at >= ?3) THEN 1 ELSE 0 END) AS action_items_open,
      SUM(CASE WHEN assignee_email IS NOT NULL AND created_at < ?3 AND (resolved = 0 OR resolved_at >= ?3) AND due_at < ?3 THEN 1 ELSE 0 END) AS action_items_overdue,
      COUNT(DISTINCT CASE WHEN created_at >= ?2 AND created_at < ?3 THEN artifact_id END) AS artifacts_discussed
    FROM artifact_comments WHERE artifact_id IN ${WS_ARTS}`,
  reactions: `SELECT COUNT(*) AS n FROM comment_reactions WHERE artifact_id IN ${WS_ARTS} AND created_at >= ?2 AND created_at < ?3`,
  approvals: `SELECT COUNT(*) AS n FROM artifact_approvals WHERE artifact_id IN ${WS_ARTS} AND created_at >= ?2 AND created_at < ?3`,
  shareLinks: `SELECT COUNT(*) AS n FROM share_links WHERE artifact_id IN ${WS_ARTS} AND created_at >= ?2 AND created_at < ?3`,
  collaborators: `SELECT COUNT(*) AS n FROM collaborators WHERE artifact_id IN ${WS_ARTS} AND added_at >= ?2 AND added_at < ?3`,
  grants: `SELECT COUNT(*) AS n FROM grants WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3`,
  deckSessions: `SELECT COUNT(*) AS sessions, SUM(completed) AS completed, AVG(slides_seen) AS avg_slides, AVG(duration_ms) AS avg_ms,
      COUNT(DISTINCT artifact_id) AS decks
    FROM view_sessions WHERE artifact_id IN ${WS_ARTS} AND started_at >= ?2 AND started_at < ?3`,
  slideViews: `SELECT COUNT(*) AS n, SUM(sv.dwell_ms) AS dwell_ms FROM slide_views sv JOIN view_sessions s ON s.id = sv.session_id
    WHERE s.artifact_id IN ${WS_ARTS} AND sv.entered_at >= ?2 AND sv.entered_at < ?3`,
  perf: `SELECT lcp, fcp, ttfb FROM artifact_perf WHERE artifact_id IN ${WS_ARTS} AND created_at >= ?2 AND created_at < ?3
    ORDER BY created_at DESC LIMIT 2000`,
  storageSnapshots: `SELECT snapshot_date AS date, bytes, max_bytes FROM workspace_storage_snapshots
    WHERE workspace_id = ?1 AND snapshot_date >= ?4 AND snapshot_date < ?5 ORDER BY snapshot_date`,
  storageLedger: `SELECT day AS date, quantity AS bytes, cost_micro_usd AS cost FROM workspace_usage_daily
    WHERE workspace_id = ?1 AND metric = 'storage_bytes' AND day >= ?4 AND day < ?5 ORDER BY day`,
} as const;

const STATIC_SQL = {
  workspace: `SELECT name FROM workspaces WHERE id = ?1`,
  admins: `SELECT u.name, u.email, m.role FROM workspace_members m JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = ?1 AND m.role IN ('owner','admin') AND m.member_class = 'internal'
      AND u.email IS NOT NULL AND COALESCE(u.disabled, 0) = 0
    UNION
    SELECT u.name, u.email, 'owner' FROM workspaces w JOIN users u ON u.id = w.owner_id
    WHERE w.id = ?1 AND u.email IS NOT NULL AND COALESCE(u.disabled, 0) = 0`,
  liveArtifacts: `SELECT a.id, a.name, COALESCE(d.slug, a.slug) AS slug, a.created_at FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    WHERE a.workspace_id = ?1 AND a.deleted_at IS NULL ORDER BY a.created_at`,
  storageTop: `SELECT s.artifact_id, a.name, s.used_bytes, s.blob_count FROM artifact_storage s JOIN artifacts a ON a.id = s.artifact_id
    WHERE a.workspace_id = ?1 AND a.deleted_at IS NULL ORDER BY s.used_bytes DESC LIMIT ${LIST}`,
  storageArtifactTotal: `SELECT COALESCE(SUM(s.used_bytes), 0) AS bytes FROM artifact_storage s JOIN artifacts a ON a.id = s.artifact_id
    WHERE a.workspace_id = ?1 AND a.deleted_at IS NULL`,
  storageLatestSnapshot: `SELECT snapshot_date AS date, bytes, max_bytes FROM workspace_storage_snapshots
    WHERE workspace_id = ?1 ORDER BY snapshot_date DESC LIMIT 1`,
  storageLatestLedger: `SELECT day AS date, quantity AS bytes FROM workspace_usage_daily
    WHERE workspace_id = ?1 AND metric = 'storage_bytes' ORDER BY day DESC LIMIT 1`,
} as const;

type Row = Record<string, unknown>;
type PeriodKey = keyof typeof PERIOD_SQL;
type StaticKey = keyof typeof STATIC_SQL;

function maxParam(sql: string): number {
  let max = 0;
  for (const m of sql.matchAll(/\?(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

function windowParams(workspaceId: string, w: Window): unknown[] {
  const f = Date.parse(w.from);
  const t = Date.parse(w.to);
  // Daily rollups are UTC days; snap the window to the nearest whole days.
  const day = (ms: number) => iso(ms + DAY_MS / 2).slice(0, 10);
  return [workspaceId, w.from, w.to, day(f), day(t), Math.floor(f / 1000), Math.floor(t / 1000)];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const usd = (micro: unknown) => Math.round(num(micro)) / 1_000_000;
const n0 = (rows: Row[], k = 'n') => num(rows[0]?.[k]);

function p75(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.ceil(v.length * 0.75) - 1)];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

async function runBatch<K extends string>(
  env: Env,
  sqls: Record<K, string>,
  params: unknown[],
): Promise<Record<K, Row[]>> {
  const keys = Object.keys(sqls) as K[];
  const res = await env.DB.batch(
    keys.map((k) => env.DB.prepare(sqls[k]).bind(...params.slice(0, maxParam(sqls[k])))),
  );
  const out = {} as Record<K, Row[]>;
  keys.forEach((k, i) => { out[k] = (res[i]?.results ?? []) as Row[]; });
  return out;
}

function shapePeriod(
  r: Record<PeriodKey, Row[]>,
  w: Window,
  base: string,
  live: Row[],
  otherPeriodEmails: Set<string> | null,
) {
  const url = (slug: unknown) => (slug ? `${base}/a/${slug}/` : null);
  const liveAtEnd = live.filter((a) => String(a.created_at) < w.to);

  // ── views
  const byArt = r.viewsByArtifact;
  const viewsMap = new Map(byArt.map((x) => [String(x.artifact_id), num(x.views)]));
  const totalViews = byArt.reduce((s, x) => s + num(x.views), 0);
  const visitorDays = byArt.reduce((s, x) => s + num(x.visitor_days), 0);
  const viewers = r.identifiedViewers;
  const internal = viewers.filter((v) => num(v.internal) === 1);
  const external = viewers.filter((v) => num(v.internal) !== 1);
  const identifiedViews = viewers.reduce((s, v) => s + num(v.views), 0);
  const members = r.members;
  const memberByEmail = new Map(members.map((m) => [String(m.email), m]));
  const emails = new Set(viewers.map((v) => String(v.email)));

  const perArtViews = liveAtEnd.map((a) => viewsMap.get(String(a.id)) ?? 0);
  const dormant = liveAtEnd.filter((a) => !viewsMap.get(String(a.id)));

  // ── people
  const created = new Map(r.creatorsByUser.map((x) => [String(x.user_id), num(x.n)]));
  const versions = new Map(r.versionsByUser.map((x) => [String(x.user_id), num(x.n)]));
  const aiUser = new Map<string, { tokens: number; cost: number }>();
  const addAi = (id: unknown, tokens: number, cost: number) => {
    if (!id) return;
    const cur = aiUser.get(String(id)) ?? { tokens: 0, cost: 0 };
    cur.tokens += tokens;
    cur.cost += cost;
    aiUser.set(String(id), cur);
  };
  for (const x of r.aiByUser) addAi(x.user_id, num(x.tokens), num(x.cost));
  for (const x of r.agentByUser) addAi(x.user_id, num(x.input_tokens) + num(x.output_tokens), num(x.cost));
  const viewsGiven = new Map(viewers.map((v) => [String(v.email), num(v.views)]));
  const activeCreators = new Set([...created.keys(), ...versions.keys()].filter((id) => id && id !== 'null'));

  const memberRows = members
    .map((m) => {
      const id = String(m.id);
      const ai = aiUser.get(id);
      return {
        name: (m.name as string | null) ?? null,
        email: (m.email as string | null) ?? null,
        role: m.role,
        external: m.member_class !== 'internal',
        artifactsCreated: created.get(id) ?? 0,
        versionsPublished: versions.get(id) ?? 0,
        viewsGiven: viewsGiven.get(String(m.email)) ?? 0,
        aiTokens: ai?.tokens ?? 0,
        aiCostUsd: usd(ai?.cost ?? 0),
      };
    })
    .filter((m) => m.artifactsCreated || m.versionsPublished || m.viewsGiven || m.aiTokens)
    .sort((a, b) => b.artifactsCreated + b.versionsPublished + b.viewsGiven - (a.artifactsCreated + a.versionsPublished + a.viewsGiven))
    .slice(0, 15);

  // ── ai
  const aiOtherCost = r.aiByKind.reduce((s, x) => s + num(x.cost), 0);
  const agentCost = r.agentByMode.reduce((s, x) => s + num(x.cost), 0);
  const agentIn = r.agentByMode.reduce((s, x) => s + num(x.input_tokens), 0);
  const agentOut = r.agentByMode.reduce((s, x) => s + num(x.output_tokens), 0);
  const userName = (id: unknown) => {
    const m = members.find((x) => x.id === id);
    return m ? (m.name as string | null) ?? (m.email as string | null) : null;
  };

  // ── jobs
  const jobsByStatus = Object.fromEntries(r.jobsByStatus.map((x) => [String(x.status), num(x.n)]));
  const seenJobs = new Set<string>();
  const failures = r.jobFailures
    .filter((x) => {
      const k = `${x.job}|${x.artifact}`;
      if (seenJobs.has(k)) return false;
      seenJobs.add(k);
      return true;
    })
    .slice(0, LIST)
    .map((x) => ({
      job: x.job,
      action: x.action,
      artifact: x.artifact,
      failures: num(x.failures),
      lastAt: iso(num(x.at) * 1000),
      error: x.error ?? null,
    }));
  const crewByStatus = Object.fromEntries(r.crewRuns.map((x) => [String(x.status), num(x.n)]));

  const c = r.comments[0] ?? {};
  const deck = r.deckSessions[0] ?? {};
  const perf = r.perf;

  return {
    artifacts: {
      created: n0(r.artifactsCreated),
      deleted: n0(r.artifactsDeleted),
      totalLive: n0(r.artifactsLive),
      versionsPublished: n0(r.versionsCreated),
      artifactsUpdated: n0(r.versionsCreated, 'artifacts'),
      productionDeploysMoved: n0(r.deploysMoved),
      new: r.newArtifacts.map((a) => ({
        name: a.name,
        url: url(a.slug),
        type: a.artifact_type ?? null,
        creator: (a.creator_name as string | null) ?? (a.creator_email as string | null) ?? null,
      })),
    },
    views: {
      total: totalViews,
      visitorDays,
      artifactsViewed: byArt.filter((x) => num(x.views) > 0).length,
      identified: {
        views: identifiedViews,
        uniqueViewers: viewers.length,
        internalViewers: internal.length,
        internalViews: internal.reduce((s, v) => s + num(v.views), 0),
        externalViewers: external.length,
        externalViews: external.reduce((s, v) => s + num(v.views), 0),
      },
      anonymousOrUntrackedViews: Math.max(0, totalViews - identifiedViews),
      topArtifacts: byArt.slice(0, LIST).map((x) => ({
        name: x.name,
        url: url(x.slug),
        views: num(x.views),
        visitorDays: num(x.visitor_days),
        identifiedViewers: num(x.identified_viewers),
      })),
      topMemberViewers: internal.slice(0, LIST).map((v) => {
        const m = memberByEmail.get(String(v.email));
        return { name: (m?.name as string | null) ?? null, email: v.email, views: num(v.views), artifacts: num(v.artifacts) };
      }),
      decks: {
        sessions: num(deck.sessions),
        completed: num(deck.completed),
        decksViewed: num(deck.decks),
        avgSlidesSeen: Math.round(num(deck.avg_slides) * 10) / 10,
        avgDurationSec: Math.round(num(deck.avg_ms) / 1000),
        slideViews: n0(r.slideViews),
        slideDwellSec: Math.round(n0(r.slideViews, 'dwell_ms') / 1000),
      },
    },
    people: {
      membersTotal: members.length,
      internalMembers: members.filter((m) => m.member_class === 'internal').length,
      newMembers: members.filter((m) => String(m.created_at) >= w.from).length,
      activeCreators: activeCreators.size,
      activeViewers: viewers.length,
      members: memberRows,
    },
    ai_usage: {
      totalCostUsd: usd(aiOtherCost + agentCost),
      agent: {
        inputTokens: agentIn,
        outputTokens: agentOut,
        costUsd: usd(agentCost),
        byMode: r.agentByMode.map((x) => ({
          mode: x.mode,
          calls: num(x.calls),
          inputTokens: num(x.input_tokens),
          outputTokens: num(x.output_tokens),
          costUsd: usd(x.cost),
        })),
      },
      other: {
        costUsd: usd(aiOtherCost),
        byKind: r.aiByKind.slice(0, 15).map((x) => ({
          kind: x.kind,
          unitKind: x.unit_kind,
          units: num(x.units),
          events: num(x.events),
          costUsd: usd(x.cost),
        })),
      },
      byUser: [...aiUser.entries()]
        .sort((a, b) => b[1].cost - a[1].cost || b[1].tokens - a[1].tokens)
        .slice(0, LIST)
        .map(([id, v]) => ({ name: userName(id), tokens: v.tokens, costUsd: usd(v.cost) })),
      unattributedAgentCostUsd: usd(r.agentByUser.filter((x) => !x.user_id).reduce((s, x) => s + num(x.cost), 0)),
      topArtifacts: r.agentByArtifact.map((x) => ({ name: x.name, tokens: num(x.tokens), costUsd: usd(x.cost) })),
    },
    jobs: {
      runs: Object.values(jobsByStatus).reduce((s, n) => s + n, 0),
      byStatus: jobsByStatus,
      failures,
      crewRuns: {
        runs: Object.values(crewByStatus).reduce((s, n) => s + n, 0),
        byStatus: crewByStatus,
        inputTokens: r.crewRuns.reduce((s, x) => s + num(x.input_tokens), 0),
        outputTokens: r.crewRuns.reduce((s, x) => s + num(x.output_tokens), 0),
        costUsd: usd(r.crewRuns.reduce((s, x) => s + num(x.cost), 0)),
      },
    },
    storage_series: {
      snapshots: r.storageSnapshots.map((x) => ({ date: x.date, bytes: num(x.bytes) })),
      usageLedger: r.storageLedger.map((x) => ({ date: x.date, bytes: num(x.bytes) })),
    },
    engagement: {
      commentsCreated: num(c.created),
      commentThreads: num(c.threads),
      commentsByAgents: num(c.by_agents),
      commentsByGuests: num(c.by_guests),
      commentsResolved: num(c.resolved),
      artifactsDiscussed: num(c.artifacts_discussed),
      reactions: n0(r.reactions),
      approvals: n0(r.approvals),
      actionItems: {
        created: num(c.action_items_created),
        completed: num(c.action_items_done),
        openAtEnd: num(c.action_items_open),
        overdueAtEnd: num(c.action_items_overdue),
      },
      shares: {
        shareLinks: n0(r.shareLinks),
        collaboratorsAdded: n0(r.collaborators),
        grants: n0(r.grants),
      },
      returningViewers: otherPeriodEmails ? [...emails].filter((e) => otherPeriodEmails.has(e)).length : null,
      artifactsViewedByNonCreators: n0(r.viewedByOthers),
      dormantArtifacts: dormant.length,
      dormantSample: dormant.slice(0, LIST).map((a) => ({ name: a.name, url: url(a.slug) })),
      medianViewsPerArtifact: median(perArtViews),
      perf: perf.length
        ? {
            samples: perf.length,
            lcpP75Ms: p75(perf.map((x) => num(x.lcp))),
            fcpP75Ms: p75(perf.map((x) => num(x.fcp))),
            ttfbP75Ms: p75(perf.map((x) => num(x.ttfb))),
          }
        : null,
    },
    _emails: emails,
  };
}

type Shaped = ReturnType<typeof shapePeriod>;

function mergeAdmins(rows: Row[]): Array<{ name: string | null; email: string; role: string }> {
  const byEmail = new Map<string, { name: string | null; email: string; role: string }>();
  for (const r of rows) {
    const key = String(r.email).toLowerCase();
    const cur = byEmail.get(key);
    if (!cur) byEmail.set(key, { name: (r.name as string | null) ?? null, email: String(r.email), role: String(r.role) });
    else if (r.role === 'owner') cur.role = 'owner';
  }
  return [...byEmail.values()].sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'owner' ? -1 : 1));
}

function delta(cur: number, prev: number) {
  return { current: cur, previous: prev, change: cur - prev, pct: prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null };
}

function deltas(c: Shaped, p: Shaped) {
  return {
    artifactsCreated: delta(c.artifacts.created, p.artifacts.created),
    versionsPublished: delta(c.artifacts.versionsPublished, p.artifacts.versionsPublished),
    views: delta(c.views.total, p.views.total),
    identifiedViewers: delta(c.views.identified.uniqueViewers, p.views.identified.uniqueViewers),
    activeCreators: delta(c.people.activeCreators, p.people.activeCreators),
    newMembers: delta(c.people.newMembers, p.people.newMembers),
    commentsCreated: delta(c.engagement.commentsCreated, p.engagement.commentsCreated),
    aiCostUsd: delta(c.ai_usage.totalCostUsd, p.ai_usage.totalCostUsd),
    jobFailures: delta(num(c.jobs.byStatus.failed), num(p.jobs.byStatus.failed)),
    dormantArtifacts: delta(c.engagement.dormantArtifacts, p.engagement.dormantArtifacts),
  };
}

/** Gather the digest. Callers must run checkDigestAccess first. */
export async function gatherWorkspaceMetricsDigest(env: Env, workspaceId: string, opts: DigestOptions = {}) {
  const period = resolveDigestPeriod(opts);
  const base = getPlatformOrigin(env);
  const cur = windowParams(workspaceId, period);
  const prevParams = period.previous ? windowParams(workspaceId, period.previous) : null;

  const [st, curRows, prevRows] = await Promise.all([
    runBatch(env, STATIC_SQL as Record<StaticKey, string>, cur),
    runBatch(env, PERIOD_SQL as Record<PeriodKey, string>, cur),
    prevParams ? runBatch(env, PERIOD_SQL as Record<PeriodKey, string>, prevParams) : Promise.resolve(null),
  ]);

  const prevEmails = prevRows ? new Set(prevRows.identifiedViewers.map((v) => String(v.email))) : null;
  const current = shapePeriod(curRows, period, base, st.liveArtifacts, prevEmails);
  const previous = prevRows && period.previous
    ? shapePeriod(prevRows, period.previous, base, st.liveArtifacts, null)
    : null;

  const notes: string[] = [
    'Views: finalised days come from UTC daily rollups (period edges snap to whole UTC days); the latest days are counted live. visitorDays sums daily-unique anonymous visitors — anonymous visitors cannot be de-duplicated across days.',
    'Identified viewers are signed-in people only; an artifact owner viewing their own page is never recorded.',
    'Crew run cost is part of ai_usage.agent (mode "crew"); jobs.crewRuns repeats it for context — do not add the two.',
  ];
  if (!current.views.total && !current.views.identified.views) notes.push('No views recorded in this period.');
  if (!st.storageLatestSnapshot.length) notes.push('workspace_storage_snapshots has no rows for this workspace.');
  if (!st.storageLatestLedger.length) notes.push('workspace_usage_daily has no storage rows for this workspace (nightly usage rollup not run yet).');
  if (!current.engagement.perf) notes.push('No real-user performance samples in this period (artifact_perf keeps 30 days).');
  if (!current.views.decks.sessions) notes.push('No deck viewing sessions in this period.');
  if (current.ai_usage.unattributedAgentCostUsd > 0) notes.push('Some agent cost has no user (visitor and admin chat threads do not always record who asked).');
  const failed = num(current.jobs.byStatus.failed);
  if (failed) notes.push(`${failed} scheduled job run(s) failed in this period.`);

  const snap = st.storageLatestSnapshot[0];
  const ledger = st.storageLatestLedger[0];
  const strip = (s: Shaped) => {
    const { _emails, storage_series, ...rest } = s;
    void _emails;
    return { ...rest, storageSeries: storage_series };
  };

  return {
    workspace: { id: workspaceId, name: (st.workspace[0]?.name as string | undefined) ?? null },
    period: {
      kind: period.kind,
      from: period.from,
      to: period.to,
      days: period.days,
      tzOffsetMinutes: period.tzOffsetMinutes,
      previous: period.previous,
    },
    generatedAt: iso(opts.now ?? Date.now()),
    current: strip(current),
    previous: previous ? strip(previous) : null,
    deltas: previous ? deltas(current, previous) : null,
    storage: {
      snapshotBytes: snap ? num(snap.bytes) : null,
      snapshotDate: snap?.date ?? null,
      snapshotMaxBytes: snap ? num(snap.max_bytes) || null : null,
      usageLedgerBytes: ledger ? num(ledger.bytes) : null,
      usageLedgerDate: ledger?.date ?? null,
      artifactBlobBytes: n0(st.storageArtifactTotal, 'bytes'),
      topArtifacts: st.storageTop.map((x) => ({ name: x.name, bytes: num(x.used_bytes), blobs: num(x.blob_count) })),
    },
    admins: mergeAdmins(st.admins),
    notes,
  };
}

export type WorkspaceMetricsDigest = Awaited<ReturnType<typeof gatherWorkspaceMetricsDigest>>;
