// Admin → Summary: how a workspace was used in one calendar month (UTC) — who read what, what was
// published, what the knowledge base holds, how much AI was asked, and the same per member — plus
// who besides the owner may open it (workspace_summary_viewers).
//
// Reads are by month boundaries on the tables that already record each thing:
//   visits     viewer_view_events (signed-in readers; an owner's own views are never recorded)
//              and analytics_daily (every view, anonymous included)
//   pages      artifacts (created / deleted) and versions (each publish)
//   knowledge  workspace_files (knowledge + catalog), asset_deliverables (files), knowledge_search calls
//   AI         agent_messages (questions people typed) and ai_usage_events (spend, at the workspace's price)
//   other      artifact_comments, job_runs, crew_runs, email_sends
// Knowledge notes have no soft delete, so a month's note count is "created by then and still there".

import type { Env, WorkspaceRole } from '../types';
import { resell } from '../data/ai-markup';

export const MAX_SUMMARY_VIEWERS = 50;
const TOP_PAGES = 50;
const TOP_OUTSIDE = 50;

export const isSummaryMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** [from, to) as ISO dates; ISO timestamps compare correctly against them as strings. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) };
}

export function previousMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/** Every month from the one the workspace was created in to the current one, newest first (max 36). */
export function monthsSince(createdAt: string | null, now = new Date()): string[] {
  const cur = now.toISOString().slice(0, 7);
  const start = createdAt && isSummaryMonth(createdAt.slice(0, 7)) && createdAt.slice(0, 7) <= cur ? createdAt.slice(0, 7) : cur;
  const out: string[] = [];
  for (let m = cur; m >= start && out.length < 36; m = previousMonthOf(m)) out.push(m);
  return out;
}

const usd = (micro: number) => Math.round((Number(micro) || 0) / 100) / 10000;
const num = (v: unknown) => Number(v) || 0;
const later = (a: string | null, b: string | null | undefined) => (!b ? a : !a || b > a ? b : a);

interface Member { user_id: string; role: WorkspaceRole; joined_at: string; email: string | null; name: string | null }
interface PerUser { user_id: string | null; n: number; last_at?: string | null; cost?: number; lookups?: number }

export interface MemberUsage {
  user_id: string; name: string | null; email: string | null; role: WorkspaceRole; joined_at: string;
  views: number; pages_created: number; publishes: number; ai_questions: number; knowledge_lookups: number;
  ai_spend_usd: number; files: number; comments: number; last_active_at: string | null;
}

export interface MonthTotals {
  month: string;
  active_people: number;
  views: number;
  readers: number;
  publishes: number;
  pages_created: number;
  ai_questions: number;
  ai_spend_usd: number;
}

const WS_ARTIFACTS = 'SELECT id FROM artifacts WHERE workspace_id = ?1';

/** The statements that are read for both the chosen month and the one before it (for the deltas). */
function monthStatements(env: Env, ws: string, from: string, to: string): D1PreparedStatement[] {
  const p = (sql: string) => env.DB.prepare(sql).bind(ws, from, to);
  return [
    // 0 signed-in views, by reader
    p(`SELECT lower(email) AS user_id, COUNT(*) AS n, MAX(viewed_at) AS last_at FROM viewer_view_events
        WHERE artifact_id IN (${WS_ARTIFACTS}) AND viewed_at >= ?2 AND viewed_at < ?3 GROUP BY lower(email)`),
    // 1 pages created, by owner
    p(`SELECT owner_id AS user_id, COUNT(*) AS n, MAX(created_at) AS last_at FROM artifacts
        WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3 GROUP BY owner_id`),
    // 2 publishes (versions), by who made them
    p(`SELECT v.created_by AS user_id, COUNT(*) AS n, MAX(v.created_at) AS last_at FROM versions v
        WHERE v.artifact_id IN (${WS_ARTIFACTS}) AND v.created_at >= ?2 AND v.created_at < ?3 GROUP BY v.created_by`),
    // 3 questions people typed to an assistant: the workspace one, and the ones on its pages
    p(`WITH th AS (
          SELECT id, user_id FROM agent_threads WHERE scope_type = 'workspace' AND scope_key = ?1
          UNION ALL
          SELECT id, user_id FROM agent_threads
           WHERE scope_type IN ('artifact_visitor', 'artifact_admin', 'editor') AND scope_key IN (${WS_ARTIFACTS}))
        SELECT th.user_id AS user_id, COUNT(*) AS n, MAX(m.created_at) AS last_at
          FROM th JOIN agent_messages m ON m.thread_id = th.id
         WHERE m.role = 'user' AND m.created_at >= ?2 AND m.created_at < ?3 GROUP BY th.user_id`),
    // 4 metered AI calls: cost and knowledge lookups, by who triggered them (NULL = automations, background work)
    p(`SELECT user_id, COUNT(*) AS n, COALESCE(SUM(base_cost_micro_usd), 0) AS cost,
              SUM(kind = 'knowledge_search') AS lookups, MAX(created_at) AS last_at
         FROM ai_usage_events WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3 GROUP BY user_id`),
    // 5 files uploaded, by owner
    p(`SELECT owner_id AS user_id, COUNT(*) AS n, MAX(created_at) AS last_at FROM asset_deliverables
        WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3 GROUP BY owner_id`),
    // 6 comments people left, by author
    p(`SELECT author_id AS user_id, COUNT(*) AS n, MAX(created_at) AS last_at FROM artifact_comments
        WHERE artifact_id IN (${WS_ARTIFACTS}) AND author_type = 'human' AND created_at >= ?2 AND created_at < ?3 GROUP BY author_id`),
  ];
}

type MonthRows = PerUser[][];

function rollUp(month: string, members: Member[], rows: MonthRows, bps: number): { totals: MonthTotals; perMember: MemberUsage[]; outside: { email: string; views: number; last_at: string | null }[] } {
  const [views, created, publishes, questions, ai, files, comments] = rows;
  const byId = (list: PerUser[]) => new Map(list.filter((r) => r.user_id).map((r) => [r.user_id as string, r]));
  const vMap = byId(views), cMap = byId(created), pMap = byId(publishes), qMap = byId(questions), aMap = byId(ai), fMap = byId(files), kMap = byId(comments);
  const memberEmails = new Set(members.map((m) => (m.email || '').toLowerCase()).filter(Boolean));

  const perMember = members.map((m): MemberUsage => {
    const v = m.email ? vMap.get(m.email.toLowerCase()) : undefined;
    const parts = [v, cMap.get(m.user_id), pMap.get(m.user_id), qMap.get(m.user_id), aMap.get(m.user_id), fMap.get(m.user_id), kMap.get(m.user_id)];
    const a = aMap.get(m.user_id);
    return {
      user_id: m.user_id, name: m.name, email: m.email, role: m.role, joined_at: m.joined_at,
      views: num(v?.n), pages_created: num(cMap.get(m.user_id)?.n), publishes: num(pMap.get(m.user_id)?.n),
      ai_questions: num(qMap.get(m.user_id)?.n), knowledge_lookups: num(a?.lookups), ai_spend_usd: usd(resell(num(a?.cost), bps)),
      files: num(fMap.get(m.user_id)?.n), comments: num(kMap.get(m.user_id)?.n),
      last_active_at: parts.reduce<string | null>((acc, r) => later(acc, r?.last_at), null),
    };
  });
  const outside = views
    .filter((r) => r.user_id && !memberEmails.has(r.user_id))
    .map((r) => ({ email: r.user_id as string, views: num(r.n), last_at: r.last_at ?? null }))
    .sort((a, b) => b.views - a.views);
  const sum = (list: PerUser[]) => list.reduce((n, r) => n + num(r.n), 0);
  return {
    perMember,
    outside,
    totals: {
      month,
      active_people: perMember.filter((m) => m.last_active_at).length,
      views: sum(views),
      readers: views.length,
      publishes: sum(publishes),
      pages_created: sum(created),
      ai_questions: sum(questions),
      ai_spend_usd: usd(resell(ai.reduce((n, r) => n + num(r.cost), 0), bps)),
    },
  };
}

/** The month's report. `bps` prices AI at what the workspace pays (never its cost). */
export async function getUsageSummary(env: Env, ws: string, month: string, bps: number, now = new Date()) {
  const { from, to } = monthRange(month);
  const prev = previousMonthOf(month);
  const pr = monthRange(prev);
  const p = (sql: string) => env.DB.prepare(sql).bind(ws, from, to);
  const fromSec = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000), toSec = Math.floor(Date.parse(`${to}T00:00:00Z`) / 1000);

  const fixed = [
    env.DB.prepare('SELECT created_at FROM workspaces WHERE id = ?').bind(ws),
    env.DB.prepare(
      `SELECT wm.user_id, wm.role, wm.created_at AS joined_at, u.email, u.name FROM workspace_members wm JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ? AND wm.member_class = 'internal' ORDER BY wm.created_at`,
    ).bind(ws),
    p(`SELECT substr(viewed_at, 1, 10) AS day, COUNT(*) AS views FROM viewer_view_events
        WHERE artifact_id IN (${WS_ARTIFACTS}) AND viewed_at >= ?2 AND viewed_at < ?3 GROUP BY day ORDER BY day`),
    p(`SELECT a.id, a.name, a.deleted_at, u.email AS owner_email, u.name AS owner_name,
              COUNT(*) AS views, COUNT(DISTINCT lower(v.email)) AS readers, MAX(v.viewed_at) AS last_viewed_at
         FROM viewer_view_events v JOIN artifacts a ON a.id = v.artifact_id LEFT JOIN users u ON u.id = a.owner_id
        WHERE a.workspace_id = ?1 AND v.viewed_at >= ?2 AND v.viewed_at < ?3
        GROUP BY a.id ORDER BY views DESC, last_viewed_at DESC LIMIT ${TOP_PAGES}`),
    p(`SELECT COALESCE(SUM(views), 0) AS views FROM analytics_daily WHERE artifact_id IN (${WS_ARTIFACTS}) AND date >= ?2 AND date < ?3`),
    p(`SELECT COALESCE(SUM(created_at < ?3 AND (deleted_at IS NULL OR deleted_at >= ?3)), 0) AS live,
              COALESCE(SUM(deleted_at >= ?2 AND deleted_at < ?3), 0) AS deleted
         FROM artifacts WHERE workspace_id = ?1`),
    p(`SELECT COUNT(DISTINCT artifact_id) AS pages FROM versions WHERE artifact_id IN (${WS_ARTIFACTS}) AND created_at >= ?2 AND created_at < ?3`),
    p(`SELECT namespace, COALESCE(SUM(created_at < ?3), 0) AS total, COALESCE(SUM(created_at >= ?2 AND created_at < ?3), 0) AS added,
              COALESCE(SUM(created_at < ?2 AND updated_at >= ?2 AND updated_at < ?3), 0) AS updated
         FROM workspace_files WHERE workspace_id = ?1 AND namespace IN ('knowledge', 'catalog') GROUP BY namespace`),
    p(`SELECT COALESCE(SUM(created_at < ?3 AND (deleted_at IS NULL OR deleted_at >= ?3)), 0) AS live FROM asset_deliverables WHERE workspace_id = ?1`),
    env.DB.prepare(
      `SELECT COUNT(*) AS runs, COALESCE(SUM(r.status = 'failed'), 0) AS failed FROM job_runs r JOIN scheduled_jobs j ON j.id = r.job_id
        WHERE j.artifact_id IN (SELECT id FROM artifacts WHERE workspace_id = ?1) AND CAST(r.created_at AS INTEGER) >= ?2 AND CAST(r.created_at AS INTEGER) < ?3`,
    ).bind(ws, fromSec, toSec), // job_runs.created_at is unix seconds (CONVENTIONS.md)
    p(`SELECT COUNT(*) AS runs, COALESCE(SUM(status = 'error'), 0) AS failed FROM crew_runs
        WHERE artifact_id IN (${WS_ARTIFACTS}) AND started_at >= ?2 AND started_at < ?3`),
    p(`SELECT COUNT(*) AS sent FROM email_sends WHERE artifact_id IN (${WS_ARTIFACTS}) AND status = 'sent' AND created_at >= ?2 AND created_at < ?3`),
    p(`WITH th AS (
          SELECT id, created_at FROM agent_threads WHERE scope_type = 'workspace' AND scope_key = ?1
          UNION ALL
          SELECT id, created_at FROM agent_threads
           WHERE scope_type IN ('artifact_visitor', 'artifact_admin', 'editor') AND scope_key IN (${WS_ARTIFACTS}))
        SELECT COUNT(*) AS n FROM th WHERE created_at >= ?2 AND created_at < ?3`),
  ];
  const cur = monthStatements(env, ws, from, to), before = monthStatements(env, ws, pr.from, pr.to);
  const res = await env.DB.batch([...fixed, ...cur, ...before]);
  const rows = (i: number) => (res[i]?.results ?? []) as Record<string, unknown>[];
  const one = (i: number) => rows(i)[0] ?? {};

  const members = rows(1) as unknown as Member[];
  const curRows = cur.map((_, i) => rows(fixed.length + i) as unknown as PerUser[]);
  const prevRows = before.map((_, i) => rows(fixed.length + cur.length + i) as unknown as PerUser[]);
  const thisMonth = rollUp(month, members, curRows, bps);
  const lastMonth = rollUp(prev, members, prevRows, bps);
  const files = curRows[5]!, lookups = curRows[4]!.reduce((n, r) => n + num(r.lookups), 0);
  const kn = Object.fromEntries(rows(7).map((r) => [String(r.namespace), { total: num(r.total), added: num(r.added), updated: num(r.updated) }]));
  const empty = { total: 0, added: 0, updated: 0 };
  const created = (one(0).created_at as string | null) ?? null;

  return {
    month,
    months: monthsSince(created, now),
    totals: thisMonth.totals,
    previous: lastMonth.totals,
    people: {
      members: members.length,
      active: thisMonth.totals.active_people,
      new_members: members.filter((m) => m.joined_at >= from && m.joined_at < to).length,
      outside_readers: thisMonth.outside.length,
    },
    visits: {
      views: thisMonth.totals.views,
      readers: thisMonth.totals.readers,
      all_views: num(one(4).views),
      daily: rows(2).map((r) => ({ day: String(r.day), views: num(r.views) })),
      top_pages: rows(3).map((r) => ({
        id: String(r.id), name: String(r.name ?? ''), deleted: !!r.deleted_at, owner_email: (r.owner_email as string) ?? null,
        owner_name: (r.owner_name as string) ?? null, views: num(r.views), readers: num(r.readers), last_viewed_at: (r.last_viewed_at as string) ?? null,
      })),
    },
    pages: {
      live: num(one(5).live),
      created: thisMonth.totals.pages_created,
      deleted: num(one(5).deleted),
      publishes: thisMonth.totals.publishes,
      pages_updated: num(one(6).pages),
    },
    knowledge: {
      notes: kn.knowledge ?? empty,
      catalog: kn.catalog ?? empty,
      files: { live: num(one(8).live), added: files.reduce((n, r) => n + num(r.n), 0) },
      lookups,
    },
    ai: {
      questions: thisMonth.totals.ai_questions,
      conversations: num(one(12).n),
      spend_usd: thisMonth.totals.ai_spend_usd,
      people: thisMonth.perMember.filter((m) => m.ai_questions || m.knowledge_lookups || m.ai_spend_usd).length,
    },
    automations: {
      job_runs: num(one(9).runs), job_failed: num(one(9).failed),
      crew_runs: num(one(10).runs), crew_failed: num(one(10).failed),
      emails_sent: num(one(11).sent),
    },
    members: thisMonth.perMember,
    outside: { people: thisMonth.outside.length, views: thisMonth.outside.reduce((n, r) => n + r.views, 0), top: thisMonth.outside.slice(0, TOP_OUTSIDE) },
  };
}

export type UsageSummary = Awaited<ReturnType<typeof getUsageSummary>>;

/** Is this admin on the owner's list? (The owner is always allowed; callers check that first.) */
export async function isSummaryViewer(env: Env, ws: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM workspace_summary_viewers WHERE workspace_id = ? AND user_id = ?').bind(ws, userId).first();
  return !!row;
}

/** The owner(s) and every internal admin, each marked with whether they can open the summary. */
export async function listSummaryViewers(env: Env, ws: string) {
  const { results } = await env.DB.prepare(
    `SELECT wm.user_id, wm.role, u.email, u.name, (sv.user_id IS NOT NULL) AS listed, sv.created_at AS added_at
       FROM workspace_members wm JOIN users u ON u.id = wm.user_id
       LEFT JOIN workspace_summary_viewers sv ON sv.workspace_id = wm.workspace_id AND sv.user_id = wm.user_id
      WHERE wm.workspace_id = ? AND wm.member_class = 'internal' AND wm.role IN ('owner', 'admin')
      ORDER BY wm.role = 'owner' DESC, COALESCE(u.name, u.email)`,
  ).bind(ws).all<{ user_id: string; role: WorkspaceRole; email: string | null; name: string | null; listed: number; added_at: string | null }>();
  return (results ?? []).map((r) => ({
    user_id: r.user_id, role: r.role, email: r.email, name: r.name,
    can_view: r.role === 'owner' || !!r.listed, added_at: r.added_at,
  }));
}

export class SummaryViewersError extends Error {}

/** Replace the list with these admins. Anyone who is not an internal admin of the workspace is refused. */
export async function setSummaryViewers(env: Env, ws: string, userIds: string[], by: string): Promise<{ added: string[]; removed: string[] }> {
  const ids = [...new Set(userIds)];
  if (ids.length > MAX_SUMMARY_VIEWERS) throw new SummaryViewersError(`At most ${MAX_SUMMARY_VIEWERS} people`);
  const admins = new Set(
    ((await env.DB.prepare(
      "SELECT user_id FROM workspace_members WHERE workspace_id = ? AND member_class = 'internal' AND role = 'admin'",
    ).bind(ws).all<{ user_id: string }>()).results ?? []).map((r) => r.user_id),
  );
  const bad = ids.filter((id) => !admins.has(id));
  if (bad.length) throw new SummaryViewersError('Only admins of this workspace can be given the summary');
  const before = new Set(
    ((await env.DB.prepare('SELECT user_id FROM workspace_summary_viewers WHERE workspace_id = ?').bind(ws).all<{ user_id: string }>()).results ?? [])
      .map((r) => r.user_id),
  );
  const added = ids.filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !ids.includes(id));
  const stmts = [
    ...removed.map((id) => env.DB.prepare('DELETE FROM workspace_summary_viewers WHERE workspace_id = ? AND user_id = ?').bind(ws, id)),
    ...added.map((id) => env.DB.prepare('INSERT INTO workspace_summary_viewers (workspace_id, user_id, added_by) VALUES (?, ?, ?)').bind(ws, id, by)),
  ];
  if (stmts.length) await env.DB.batch(stmts);
  return { added, removed };
}
