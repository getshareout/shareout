/**
 * Home activity feed — action items, Pulse, merged feed, dismissals.
 */
import type { Env, WorkspaceRole } from '../../../types';
import { getVisibilityScope, placeholders, type VisibilityScope } from '../../../account-links';
import type { ActionItem, ActivityEvent, ActivityFeed, PulseEvent } from '../types';
import { homeScopeSql } from '../filters';
import { getInternalWorkspaceRole } from '../../../workspaces/roles';
import { type ActivityKind, type AudienceMap, resolveWorkspaceAudiences } from '../events';
import { type ActivityFeedOpts, windowCutoff, trim140, stripMentionTokens, kindScope } from './shared';
import { queryNeedsYou } from './activity-needs-you';

/**
 * Cross-artifact "My action items": comments assigned to the viewer that are still
 * open (actionable via Done), PLUS comments the viewer authored that were completed
 * in the last 7 days (actionable via Reopen — they age out, no dismissal rows).
 * An assignment itself grants relevance, so scope is simply any non-deleted artifact.
 * Open items sort by due_at (nulls last) then newest; each row carries resolved state
 * so the client can pick the Done vs Reopen affordance.
 */
export async function queryActionItems(
  env: Env,
  user: { id: string; email: string | null },
  workspaceId?: string | null,
): Promise<{ items: ActionItem[]; requestedOpen: number }> {
  const wsFilter = workspaceId ? ' AND a.workspace_id = ?' : '';
  const emailLower = user.email ? user.email.toLowerCase() : null;
  const wsBind = workspaceId ? [workspaceId] : [];

  const [rows, req] = await Promise.all([
    env.DB.prepare(`
      SELECT ac.id AS id, a.id AS artifact_id, a.name AS artifact_name, a.slug AS slug,
             ac.author_name AS actor, ac.content AS content, ac.due_at AS due_at,
             CAST(strftime('%s', ac.created_at) AS INTEGER) AS ts,
             ac.resolved AS resolved, ac.resolved_by AS resolved_by, ac.resolved_at AS resolved_at
      FROM artifact_comments ac
      JOIN artifacts a ON a.id = ac.artifact_id
      WHERE a.deleted_at IS NULL${wsFilter} AND (
        (ac.resolved = 0 AND (ac.assignee_user_id = ? OR (? IS NOT NULL AND lower(ac.assignee_email) = ?)))
        OR (ac.resolved = 1 AND ac.assignee_email IS NOT NULL AND ac.author_id = ?
            AND ac.resolved_at > strftime('%Y-%m-%dT%H:%M:%fZ','now', '-7 days'))
      )
      ORDER BY CASE WHEN ac.due_at IS NULL THEN 1 ELSE 0 END, ac.due_at ASC, ac.created_at DESC
      LIMIT 50
    `).bind(...wsBind, user.id, emailLower, emailLower, user.id).all<{
      id: string; artifact_id: string; artifact_name: string | null; slug: string | null;
      actor: string | null; content: string | null; due_at: string | null; ts: number;
      resolved: number; resolved_by: string | null; resolved_at: string | null;
    }>(),
    env.DB.prepare(`
      SELECT COUNT(*) AS n FROM artifact_comments ac
      JOIN artifacts a ON a.id = ac.artifact_id
      WHERE a.deleted_at IS NULL${wsFilter} AND ac.author_id = ? AND ac.resolved = 0
        AND (ac.assignee_user_id IS NOT NULL OR ac.assignee_email IS NOT NULL)
    `).bind(...wsBind, user.id).first<{ n: number }>(),
  ]);

  const items: ActionItem[] = (rows.results || []).map((r) => ({
    id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name, slug: r.slug,
    actor: r.actor, summary: trim140(stripMentionTokens(r.content || '')), due_at: r.due_at, ts: r.ts,
    resolved: r.resolved, resolved_by: r.resolved_by, resolved_at: r.resolved_at,
  }));
  return { items, requestedOpen: req?.n || 0 };
}

/**
 * "Pulse" — AMBIENT events AGGREGATED into per-(kind, artifact, window) counts.
 * One row collapses N raw events, so a 500-person workspace's 100k raw events
 * become dozens of digest rows. Each source is gated by `kindScope` (audience ×
 * viewer role): skipped, the viewer's own slice, or the full visible set.
 * Owned artifacts sort first (light relevance), then most-recent.
 */
export async function queryPulse(
  env: Env,
  user: { id: string; email: string | null },
  opts: ActivityFeedOpts = {},
  visArg?: VisibilityScope,
  roleArg?: WorkspaceRole | null,
  audiencesArg?: AudienceMap,
): Promise<PulseEvent[]> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const workspaceId = opts.workspaceId ?? null;
  const isPersonal = !workspaceId;
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
  const window = opts.window ?? '7d';
  const cutoff = windowCutoff(window);
  const role = roleArg !== undefined ? roleArg : (workspaceId ? await getInternalWorkspaceRole(env, workspaceId, user.id) : null);
  const aud = audiencesArg ?? await resolveWorkspaceAudiences(env, workspaceId);
  const idPh = placeholders(vis.userIds.length);
  const PER = 8; // per-source cap on aggregated rows

  // Artifact visibility for a 'full' pulse source. 'own' tightens to owner-only.
  const base = homeScopeSql(vis, workspaceId);
  const ownWhere = `a.deleted_at IS NULL AND a.owner_id IN (${idPh}) AND ${workspaceId ? 'a.workspace_id = ?' : 'a.workspace_id IS NULL'}`;
  const ownParams = workspaceId ? [...vis.userIds, workspaceId] : [...vis.userIds];

  const sources: Promise<{ results: any[] | null }>[] = [];
  const tag: Array<(rows: any[]) => PulseEvent[]> = [];

  /** Aggregate one artifact-scoped ambient kind: COUNT + MAX(ts), grouped by artifact. */
  function artifactSource(
    kind: ActivityKind,
    from: string,                 // FROM…JOIN artifacts a… (alias `a`), with a `ts_expr` and optional extra
    tsExpr: string,
    extraWhere: string,
    summarize: (count: number) => string,
    ownExtra = '',                // extra predicate applied only when scope==='own' (e.g. f.user_id IN …)
    ownExtraParams: unknown[] = [],
  ) {
    const scope = kindScope(aud[kind], role, isPersonal);
    if (scope === 'skip') return;
    const scopeJoin = scope === 'full' ? base.join : '';
    const scopeWhere = scope === 'full' ? base.where : ownWhere;
    const scopeParams = scope === 'full' ? [...base.joinParams, ...base.whereParams] : ownParams;
    const own = scope === 'own' ? ownExtra : '';
    const ownP = scope === 'own' ? ownExtraParams : [];
    sources.push(env.DB.prepare(`
      SELECT a.id AS artifact_id, a.name AS artifact_name, a.slug AS slug,
             (a.owner_id IN (${idPh})) AS owned,
             COUNT(*) AS count, MAX(${tsExpr}) AS ts
      FROM ${from}
      ${scopeJoin}
      WHERE ${scopeWhere} AND ${tsExpr} >= ? ${extraWhere} ${own}
      GROUP BY a.id ORDER BY ts DESC LIMIT ?
    `).bind(...vis.userIds, ...scopeParams, cutoff, ...ownP, PER).all());
    tag.push((rows) => rows.map((r) => ({
      kind, id: `${kind}:${r.artifact_id}`, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
      slug: r.slug, count: r.count, summary: summarize(r.count), ts: r.ts, owned: !!r.owned,
    } as PulseEvent & { owned: boolean })));
  }

  // publish / create — split on version_no.
  artifactSource('publish', 'versions v JOIN artifacts a ON a.id = v.artifact_id',
    `CAST(strftime('%s', v.created_at) AS INTEGER)`, 'AND v.version_no > 1',
    (n) => `${n} update${n === 1 ? '' : 's'} published`);
  artifactSource('create', 'versions v JOIN artifacts a ON a.id = v.artifact_id',
    `CAST(strftime('%s', v.created_at) AS INTEGER)`, 'AND v.version_no = 1',
    (n) => n === 1 ? 'created' : `${n} artifacts created`);
  // favorite — self by default → own slice = the viewer's own stars.
  artifactSource('favorite', 'favorites f JOIN artifacts a ON a.id = f.artifact_id',
    `CAST(strftime('%s', f.added_at) AS INTEGER)`, '',
    (n) => n === 1 ? 'favorited' : `favorited ${n}×`,
    `AND f.user_id IN (${idPh})`, [...vis.userIds]);
  // view — self by default → own slice = views on the viewer's own artifacts.
  artifactSource('view', 'analytics_events ae JOIN artifacts a ON a.id = ae.artifact_id',
    `ae.timestamp`, `AND ae.event_type = 'view'`,
    (n) => `+${n} view${n === 1 ? '' : 's'}`);
  // connection — data sources wired up (platform OAuth connectors tracked separately).
  artifactSource('connection', 'connections cn JOIN artifacts a ON a.id = cn.artifact_id',
    `CAST(strftime('%s', cn.created_at) AS INTEGER)`, '',
    (n) => n === 1 ? 'connected a data source' : `${n} data sources connected`);
  // skill — skills attached to a target artifact.
  artifactSource('skill', 'artifact_skills sk JOIN artifacts a ON a.id = sk.artifact_id',
    `CAST(strftime('%s', sk.created_at) AS INTEGER)`, '',
    (n) => n === 1 ? 'skill attached' : `${n} skills attached`);
  // run — SUCCESSFUL job/crew runs (failures are in Needs You).
  artifactSource('run', 'job_runs jl JOIN scheduled_jobs sj ON sj.id = jl.job_id JOIN artifacts a ON a.id = sj.artifact_id',
    `jl.created_at`, `AND jl.status = 'success'`,
    (n) => `${n} run${n === 1 ? '' : 's'} succeeded`);

  // Workspace-level (no artifact): member joins + AI assistant activity. Workspace scope only.
  if (workspaceId) {
    if (kindScope(aud.member, role, isPersonal) === 'full') {
      sources.push(env.DB.prepare(`
        SELECT COUNT(*) AS count, MAX(CAST(strftime('%s', created_at) AS INTEGER)) AS ts
        FROM workspace_members WHERE workspace_id = ? AND CAST(strftime('%s', created_at) AS INTEGER) >= ?
      `).bind(workspaceId, cutoff).all());
      tag.push((rows) => (rows[0]?.count ? [{
        kind: 'member', id: 'member:ws', artifact_id: null, artifact_name: null, slug: null,
        count: rows[0].count, summary: `${rows[0].count} ${rows[0].count === 1 ? 'person' : 'people'} joined`, ts: rows[0].ts,
      }] : []));
    }
    if (kindScope(aud.agent, role, isPersonal) !== 'skip') {
      sources.push(env.DB.prepare(`
        SELECT COUNT(*) AS count, MAX(CAST(strftime('%s', m.created_at) AS INTEGER)) AS ts
        FROM agent_messages m
        JOIN agent_threads t ON t.id = m.thread_id
        WHERE t.scope_type = 'workspace' AND t.scope_key = ? AND t.user_id IN (${idPh})
          AND m.role = 'assistant' AND CAST(strftime('%s', m.created_at) AS INTEGER) >= ?
      `).bind(workspaceId, ...vis.userIds, cutoff).all());
      tag.push((rows) => (rows[0]?.count ? [{
        kind: 'agent', id: 'agent:ws', artifact_id: null, artifact_name: null, slug: null,
        count: rows[0].count, summary: `assistant ran ${rows[0].count} task${rows[0].count === 1 ? '' : 's'}`, ts: rows[0].ts,
      }] : []));
    }
  }

  const settled = await Promise.all(sources);
  const rows = settled.flatMap((res, i) => tag[i](res.results || [])) as Array<PulseEvent & { owned?: boolean }>;
  rows.sort((x, y) => (Number(!!y.owned) - Number(!!x.owned)) || (y.ts - x.ts));
  return rows.slice(0, limit).map(({ owned: _o, ...e }) => e);
}

/**
 * The full activity payload for the right rail + Brief: actionable "Needs You"
 * rows plus the aggregated "Pulse". Resolves visibility (workspace role +
 * per-workspace audience overrides) once and shares it across both surfaces.
 */
export async function queryActivityFeed(
  env: Env,
  user: { id: string; email: string | null },
  opts: ActivityFeedOpts = {},
  visArg?: VisibilityScope,
): Promise<ActivityFeed> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const workspaceId = opts.workspaceId ?? null;
  const window = opts.window ?? '7d';
  const [role, aud] = await Promise.all([
    workspaceId ? getInternalWorkspaceRole(env, workspaceId, user.id) : Promise.resolve(null),
    resolveWorkspaceAudiences(env, workspaceId),
  ]);
  const [needs, pulse, dismissed, action] = await Promise.all([
    queryNeedsYou(env, user, opts, vis, aud, role),
    queryPulse(env, user, opts, vis, role, aud),
    queryDismissedEventIds(env, user.id),
    queryActionItems(env, user, workspaceId),
  ]);
  // ponytail: "seen" = dismissed needs still inside this query's window/limit; older ones age out. Widen the window if a full archive is needed.
  const visibleNeeds = dismissed.size ? needs.filter((n) => !dismissed.has(n.id)) : needs;
  const seen = dismissed.size ? needs.filter((n) => dismissed.has(n.id)) : [];
  return { needs: visibleNeeds, seen, pulse, window, actionItems: action.items, requestedOpen: action.requestedOpen };
}

/** Event ids this user has dismissed from their "Needs you" surface. */
export async function queryDismissedEventIds(env: Env, userId: string): Promise<Set<string>> {
  try {
    const r = await env.DB.prepare('SELECT event_id FROM home_event_dismissals WHERE user_id = ?').bind(userId).all();
    return new Set((r.results || []).map((x) => String((x as { event_id: string }).event_id)));
  } catch {
    return new Set();
  }
}

/** Persist one or more event dismissals for a user (idempotent, capped per call). */
export async function dismissHomeEvents(env: Env, userId: string, eventIds: string[]): Promise<void> {
  const ids = eventIds.filter((s) => typeof s === 'string' && s).slice(0, 50);
  if (!ids.length) return;
  const stmt = env.DB.prepare('INSERT OR IGNORE INTO home_event_dismissals (user_id, event_id) VALUES (?, ?)');
  await env.DB.batch(ids.map((id) => stmt.bind(userId, id)));
}

/** Back-compat: the old merged single-stream shape (actionable rows only, as
 *  before, plus aggregated ambient flattened in) for any caller still importing it. */
export async function queryWorkspaceActivity(
  env: Env,
  user: { id: string; email: string | null },
  opts: ActivityFeedOpts = {},
  visArg?: VisibilityScope,
): Promise<ActivityEvent[]> {
  const { needs } = await queryActivityFeed(env, user, opts, visArg);
  return needs;
}
