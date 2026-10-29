/**
 * "Needs You" actionable events — comments, shares, failures, alerts, etc.
 */
import type { Env, WorkspaceRole } from '../../../types';
import { getVisibilityScope, placeholders, type VisibilityScope } from '../../../account-links';
import type { ActivityEvent } from '../types';
import { homeScopeSql } from '../filters';
import { getInternalWorkspaceRole } from '../../../workspaces/roles';
import { type ActivityKind, type AudienceMap, resolveWorkspaceAudiences } from '../events';
import { parseAccessPolicy, resolveViewerScope } from '../../../data/access-policy';
import { type ActivityFeedOpts, trim140, stripMentionTokens } from './shared';

/**
 * "Needs You" — ACTIONABLE events as individual rows, hard-bounded. These are
 * inherently directed at the viewer (on artifacts they own/collaborate on, or
 * shared to them), so they pass visibility unless the kind is turned 'off'.
 * Failed runs / failed tests are promoted here even though their default surface
 * is the Pulse — a failure needs a human. Naturally small per person.
 */
export async function queryNeedsYou(
  env: Env,
  user: { id: string; email: string | null },
  opts: ActivityFeedOpts = {},
  visArg?: VisibilityScope,
  audiencesArg?: AudienceMap,
  roleArg?: WorkspaceRole | null,
): Promise<ActivityEvent[]> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const workspaceId = opts.workspaceId ?? null;
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const aud = audiencesArg ?? await resolveWorkspaceAudiences(env, workspaceId);
  const base = homeScopeSql(vis, workspaceId);
  const idPh = placeholders(vis.userIds.length);
  const emailPh = placeholders(vis.emails.length);
  const on = (k: ActivityKind) => aud[k] !== 'off';

  // Every source is independent: one D1 batch, one round trip.
  const sources: D1PreparedStatement[] = [];
  const tag: Array<(rows: any[]) => ActivityEvent[]> = [];
  const push = (q: D1PreparedStatement, map: (rows: any[]) => ActivityEvent[]) => {
    sources.push(q); tag.push(map);
  };

  // Comments + replies (unresolved) on artifacts I can see, not authored by me.
  // A comment that names me is classified as its own 'mention' kind: it is directed
  // at me, so it must not be indistinguishable from — or suppressed along with — the
  // general comment stream. Mentions are matched on the stored `mentions` JSON array,
  // the same field the email/Telegram notifier reads.
  const lowerEmails = vis.emails.map((e) => e.toLowerCase());
  if (on('comment') || on('reply') || on('mention')) {
    push(env.DB.prepare(`
      SELECT ac.id AS id, a.id AS artifact_id, a.name AS artifact_name, a.slug AS slug,
             ac.author_name AS actor,
             (SELECT picture FROM users WHERE id = ac.author_id) AS actor_picture,
             ac.content AS content,
             CASE
               WHEN json_valid(ac.mentions) AND EXISTS (
                      SELECT 1 FROM json_each(ac.mentions) me
                       WHERE lower(me.value) IN (${emailPh})
                    ) THEN 'mention'
               WHEN ac.parent_id IS NULL THEN 'comment'
               ELSE 'reply' END AS kind,
             CAST(strftime('%s', ac.created_at) AS INTEGER) AS ts
      FROM artifact_comments ac
      JOIN artifacts a ON a.id = ac.artifact_id
      ${base.join}
      WHERE ${base.where} AND ac.resolved = 0 AND (ac.author_id IS NULL OR ac.author_id NOT IN (${idPh}))
        AND (ac.assignee_user_id IS NULL OR ac.assignee_user_id NOT IN (${idPh}))
        AND (ac.assignee_email IS NULL${emailPh ? ` OR lower(ac.assignee_email) NOT IN (${emailPh})` : ''})
      GROUP BY ac.id ORDER BY ac.created_at DESC LIMIT ?
    `).bind(...lowerEmails, ...base.joinParams, ...base.whereParams, ...vis.userIds, ...vis.userIds, ...lowerEmails, limit),
      (rows) => rows.filter((r) => on(r.kind as ActivityKind)).map((r) => {
        const body = trim140(stripMentionTokens(r.content || ''));
        return {
          kind: r.kind, id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
          slug: r.slug, actor: r.actor, actor_picture: r.actor_picture,
          summary: r.kind === 'mention' ? `mentioned you · ${body}` : body, ts: r.ts,
        };
      }));
  }

  // Artifacts shared TO me (collaborator, not owner).
  if (on('share')) {
    push(env.DB.prepare(`
      SELECT sh.id AS id, a.id AS artifact_id, a.name AS artifact_name, a.slug AS slug,
             (SELECT name FROM users WHERE id = sh.added_by) AS actor,
             (SELECT picture FROM users WHERE id = sh.added_by) AS actor_picture,
             CAST(strftime('%s', sh.added_at) AS INTEGER) AS ts
      FROM collaborators sh
      JOIN artifacts a ON a.id = sh.artifact_id
      WHERE sh.email IN (${emailPh}) AND a.deleted_at IS NULL AND a.owner_id NOT IN (${idPh})
        ${workspaceId ? 'AND a.workspace_id = ?' : ''}
      ORDER BY sh.added_at DESC LIMIT ?
    `).bind(...vis.emails, ...vis.userIds, ...(workspaceId ? [workspaceId] : []), limit),
      (rows) => rows.map((r) => ({
        kind: 'share', id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
        slug: r.slug, actor: r.actor, actor_picture: r.actor_picture, summary: 'shared this with you', ts: r.ts,
      })));
  }

  // Pending access requests on artifacts I own.
  if (on('access')) {
    push(env.DB.prepare(`
      SELECT ar.id AS id, a.id AS artifact_id, a.name AS artifact_name, a.slug AS slug,
             ar.requester_email AS actor, ar.role AS role,
             CAST(strftime('%s', ar.created_at) AS INTEGER) AS ts
      FROM access_requests ar
      JOIN artifacts a ON a.id = ar.artifact_id
      WHERE ar.status = 'pending' AND a.deleted_at IS NULL AND a.owner_id IN (${idPh})
        ${workspaceId ? 'AND a.workspace_id = ?' : ''}
      ORDER BY ar.created_at DESC LIMIT ?
    `).bind(...vis.userIds, ...(workspaceId ? [workspaceId] : []), limit),
      (rows) => rows.map((r) => ({
        kind: 'access', id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
        slug: r.slug, actor: r.actor, actor_picture: null, summary: `${r.role === 'editor' ? 'wants to edit' : 'wants access'} · ${r.actor}`, ts: r.ts,
      })));
  }

  // Metric-alert triggers (matched only).
  if (on('alert')) {
    push(env.DB.prepare(`
      SELECT e.id AS id, a.id AS artifact_id, a.name AS artifact_name, a.slug AS slug,
             e.message AS message, CAST(strftime('%s', e.evaluated_at) AS INTEGER) AS ts
      FROM metric_alert_runs e
      JOIN artifacts a ON a.id = e.artifact_id
      ${base.join}
      WHERE ${base.where} AND e.matched = 1
      GROUP BY e.id ORDER BY e.evaluated_at DESC LIMIT ?
    `).bind(...base.joinParams, ...base.whereParams, limit),
      (rows) => rows.map((r) => ({
        kind: 'alert', id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
        slug: r.slug, actor: null, actor_picture: null, summary: r.message || 'alert triggered', ts: r.ts,
      })));
  }

  // Stale-data sentinel triggers (Sheets sources that haven't synced in 7+ days).
  if (on('stale_data')) {
    push(env.DB.prepare(`
      SELECT e.id AS id, a.id AS artifact_id, a.name AS artifact_name, a.slug AS slug,
             e.message AS message, CAST(strftime('%s', e.created_at) AS INTEGER) AS ts
      FROM notifications e
      JOIN artifacts a ON a.id = e.recipient_id
      ${base.join}
      WHERE ${base.where} AND e.recipient_type = 'artifact' AND e.kind = 'stale_data'
      GROUP BY e.id ORDER BY e.created_at DESC LIMIT ?
    `).bind(...base.joinParams, ...base.whereParams, limit),
      (rows) => rows.map((r) => ({
        kind: 'stale_data', id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
        slug: r.slug, actor: null, actor_picture: null, summary: r.message, ts: r.ts,
      })));
  }

  // Metric-watch triggers (a watched metric moved past its threshold).
  if (on('metric_watch')) {
    push(env.DB.prepare(`
      SELECT e.id AS id, a.id AS artifact_id, a.name AS artifact_name, a.slug AS slug,
             e.message AS message, CAST(strftime('%s', e.created_at) AS INTEGER) AS ts,
             a.access_policy AS access_policy,
             (a.owner_id IN (${idPh}) OR EXISTS (
               SELECT 1 FROM collaborators c
                WHERE c.artifact_id = a.id AND c.role IN ('owner', 'editor') AND lower(c.email) IN (${emailPh})
             )) AS unscoped
      FROM notifications e
      JOIN artifacts a ON a.id = e.recipient_id
      ${base.join}
      WHERE ${base.where} AND e.recipient_type = 'artifact' AND e.kind = 'metric_watch'
      GROUP BY e.id ORDER BY e.created_at DESC LIMIT ?
    `).bind(...vis.userIds, ...lowerEmails, ...base.joinParams, ...base.whereParams, limit),
      (rows) => rows.filter((r) => {
        if (!r.access_policy || r.unscoped) return true;
        const policy = parseAccessPolicy(r.access_policy);
        return !!policy && !resolveViewerScope(policy, { email: user.email, isOwner: false });
      }).map((r) => ({
        kind: 'metric_watch', id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
        slug: r.slug, actor: null, actor_picture: null, summary: r.message, ts: r.ts,
      })));
  }

  // Never-viewed janitor: workspace-level cleanup suggestion (published pages nobody
  // has opened in 90+ days). One aggregated card per monthly sweep; only recent events
  // surface so a stale month-old count doesn't linger. Workspace scope only.
  // Unlike artifact-directed needs (comments on YOUR pages), this card is a workspace
  // governance signal — enforce its audience here: admins by default, everyone only
  // when an admin widened the kind to 'members' in visibility settings.
  const janAud = aud['unused_artifacts'];
  const mapUnused = (wsId: string | null) => (rows: any[]) => rows.map((r) => ({
    kind: 'unused_artifacts' as const, id: r.id, artifact_id: null, artifact_name: null, slug: null,
    actor: null, actor_picture: null,
    summary: `${r.count} page${r.count === 1 ? '' : 's'} haven't been opened in 90+ days — worth archiving?`,
    ts: r.ts, count: r.count, workspaceId: wsId,
  }));
  if (janAud !== 'off' && workspaceId) {
    const role = roleArg !== undefined ? roleArg : await getInternalWorkspaceRole(env, workspaceId, user.id);
    const janVisible = janAud === 'members' ? role !== null : role === 'owner' || role === 'admin';
    if (janVisible) {
      push(env.DB.prepare(`
        SELECT e.id AS id, json_extract(e.payload, '$.artifact_count') AS count,
               CAST(strftime('%s', e.created_at) AS INTEGER) AS ts
        FROM notifications e
        WHERE e.recipient_type = 'workspace' AND e.recipient_id = ? AND e.kind = 'unused_artifacts'
          AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-35 days')
        ORDER BY e.created_at DESC LIMIT ?
      `).bind(workspaceId, limit), mapUnused(workspaceId));
    }
  } else if (janAud !== 'off' && !workspaceId) {
    // Personal scope: your own data, no role concept — visible whenever the kind is on.
    push(env.DB.prepare(`
      SELECT e.id AS id, json_extract(e.payload, '$.artifact_count') AS count,
             CAST(strftime('%s', e.created_at) AS INTEGER) AS ts
      FROM notifications e
      WHERE e.recipient_type = 'user' AND e.recipient_id IN (${idPh}) AND e.kind = 'unused_artifacts'
        AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-35 days')
      ORDER BY e.created_at DESC LIMIT ?
    `).bind(...vis.userIds, limit), mapUnused(null));
  }

  // Moderation resolves on YOUR pages: a held page that passed review (links to the
  // now-live page) or got blocked (dead end → no link, the summary says why). Owner-
  // directed rows, so scope is your own user ids regardless of workspace.
  if (on('moderation')) {
    push(env.DB.prepare(`
      SELECT e.id AS id, e.subject_id AS artifact_id,
             json_extract(e.payload, '$.artifact_name') AS artifact_name,
             json_extract(e.payload, '$.slug') AS slug,
             json_extract(e.payload, '$.event') AS event,
             CAST(strftime('%s', e.created_at) AS INTEGER) AS ts
      FROM notifications e
      WHERE e.recipient_type = 'user' AND e.recipient_id IN (${idPh}) AND e.kind = 'moderation'
        AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-14 days')
      ORDER BY e.created_at DESC LIMIT ?
    `).bind(...vis.userIds, limit),
      (rows) => rows.map((r) => ({
        kind: 'moderation' as const, id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
        slug: r.event === 'approved' ? r.slug : null, actor: null, actor_picture: null,
        summary: r.event === 'approved' ? 'passed review — now public' : 'was blocked by review', ts: r.ts,
      })));
  }

  // The team answered a help request you opened. Directed at you; links back to Home,
  // where the Help panel holds the thread.
  if (on('support_reply')) {
    push(env.DB.prepare(`
      SELECT e.id AS id, e.message AS subject, CAST(strftime('%s', e.created_at) AS INTEGER) AS ts
      FROM notifications e
      WHERE e.recipient_type = 'user' AND e.recipient_id IN (${idPh}) AND e.kind = 'support_reply'
        AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-30 days')
      ORDER BY e.created_at DESC LIMIT ?
    `).bind(...vis.userIds, limit),
      (rows) => rows.map((r) => ({
        kind: 'support_reply' as const, id: r.id, artifact_id: null, artifact_name: r.subject,
        slug: null, actor: null, actor_picture: null, summary: 'support replied to your request', ts: r.ts,
      })));
  }

  // A member asked you (an admin) to do something only admins can ("Ask an admin").
  // Scoped to the workspace you're looking at; the action they tried rides as the summary.
  if (on('admin_request')) {
    push(env.DB.prepare(`
      SELECT e.id AS id, e.message AS action,
             json_extract(e.payload, '$.requester_name') AS actor,
             json_extract(e.payload, '$.message') AS reason,
             CAST(strftime('%s', e.created_at) AS INTEGER) AS ts
      FROM notifications e
      WHERE e.recipient_type = 'user' AND e.recipient_id IN (${idPh}) AND e.kind = 'admin_request'
        AND (? IS NULL OR e.subject_id = ?)
        AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-14 days')
      ORDER BY e.created_at DESC LIMIT ?
    `).bind(...vis.userIds, workspaceId, workspaceId, limit),
      (rows) => rows.map((r) => ({
        kind: 'admin_request' as const, id: r.id, artifact_id: null, artifact_name: r.reason || null,
        slug: null, actor: r.actor, actor_picture: null,
        summary: r.action ? `needs an admin: ${r.action}` : 'needs an admin', ts: r.ts,
      })));
  }

  // Review and sharing notices addressed to you (src/notify/review-notify.ts): an approval
  // of your version, an outside person opening a folder you shared, new versions of what
  // you follow. One row each; the payload carries the line's parts.
  const directed = (['version_approved', 'folder_first_open', 'version_published'] as const).filter(on);
  if (directed.length) {
    push(env.DB.prepare(`
      SELECT e.id AS id, e.kind AS kind, e.subject_id AS artifact_id,
             json_extract(e.payload, '$.artifact_name') AS artifact_name,
             json_extract(e.payload, '$.slug') AS slug,
             json_extract(e.payload, '$.actor') AS actor,
             json_extract(e.payload, '$.version_no') AS version_no,
             json_extract(e.payload, '$.note') AS note,
             json_extract(e.payload, '$.folder_name') AS folder_name,
             CAST(strftime('%s', e.created_at) AS INTEGER) AS ts
      FROM notifications e
      WHERE e.recipient_type = 'user' AND e.recipient_id IN (${idPh}) AND e.kind IN (${placeholders(directed.length)})
        AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-14 days')
      ORDER BY e.created_at DESC LIMIT ?
    `).bind(...vis.userIds, ...directed, limit),
      (rows) => rows.map((r) => ({
        kind: r.kind as ActivityKind, id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
        slug: r.slug, actor: r.actor, actor_picture: null,
        summary: r.kind === 'version_approved' ? `approved ${r.version_no ? `v${r.version_no}` : 'the live version'}`
          : r.kind === 'folder_first_open' ? `opened it · ${r.folder_name ?? 'a shared folder'}`
          : `published v${r.version_no}${r.note ? ` · ${trim140(r.note)}` : ''}`,
        ts: r.ts,
      })));
  }

  // A page build you started that ended while you were away (src/build-jobs): the line was
  // written in your language when it ended; it links to the page when there is one.
  if (on('page_build')) {
    push(env.DB.prepare(`
      SELECT e.id AS id,
             json_extract(e.payload, '$.artifact_id') AS artifact_id,
             json_extract(e.payload, '$.artifact_name') AS artifact_name,
             json_extract(e.payload, '$.slug') AS slug,
             json_extract(e.payload, '$.summary') AS summary,
             CAST(strftime('%s', e.created_at) AS INTEGER) AS ts
      FROM notifications e
      WHERE e.recipient_type = 'user' AND e.recipient_id IN (${idPh}) AND e.kind = 'page_build'
        AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-14 days')
      ORDER BY e.created_at DESC LIMIT ?
    `).bind(...vis.userIds, limit),
      (rows) => rows.map((r) => ({
        kind: 'page_build' as const, id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
        slug: r.slug, actor: null, actor_picture: null, summary: r.summary || '', ts: r.ts,
      })));
  }

  // Failed / errored test runs.
  if (on('test')) {
    push(env.DB.prepare(`
      SELECT tr.id AS id, a.id AS artifact_id, a.name AS artifact_name, a.slug AS slug,
             tr.status AS status, tr.failed_count AS failed_count,
             CAST(strftime('%s', tr.started_at) AS INTEGER) AS ts
      FROM artifact_test_runs tr
      JOIN artifacts a ON a.id = tr.artifact_id
      ${base.join}
      WHERE ${base.where} AND tr.status IN ('failed', 'errored')
      GROUP BY tr.id ORDER BY tr.started_at DESC LIMIT ?
    `).bind(...base.joinParams, ...base.whereParams, limit),
      (rows) => rows.map((r) => ({
        kind: 'test', id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
        slug: r.slug, actor: null, actor_picture: null,
        summary: r.status === 'errored' ? 'tests errored' : `${r.failed_count || ''} test${r.failed_count === 1 ? '' : 's'} failed`.trim(), ts: r.ts,
      })));
  }

  // Files emailed into the workspace inbox (blob_origins → workspace asset bucket).
  if (on('file') && workspaceId) {
    push(env.DB.prepare(`
      SELECT o.blob_id AS id, b.filename AS filename, o.sender AS actor, o.subject AS subject,
             CAST(strftime('%s', o.created_at) AS INTEGER) AS ts
      FROM blob_origins o
      JOIN blobs b ON b.id = o.blob_id
      JOIN asset_buckets ab ON ab.artifact_id = b.artifact_id
      WHERE ab.workspace_id = ? AND o.source = 'email'
      ORDER BY o.created_at DESC LIMIT ?
    `).bind(workspaceId, limit),
      (rows) => rows.map((r) => ({
        kind: 'file' as const, id: r.id, artifact_id: null, artifact_name: r.filename,
        slug: null, actor: r.actor, actor_picture: null,
        summary: r.subject ? `emailed: ${r.subject}` : 'emailed a file', ts: r.ts,
      })));
  }

  // Failed job/crew runs (successes go to the Pulse, aggregated).
  if (on('run')) {
    push(env.DB.prepare(`
      SELECT jl.id AS id, a.id AS artifact_id, a.name AS artifact_name, a.slug AS slug,
             sj.action AS action, sj.title AS title, jl.error AS error, CAST(strftime('%s', jl.created_at) AS INTEGER) AS ts
      FROM job_runs jl
      JOIN scheduled_jobs sj ON sj.id = jl.job_id
      JOIN artifacts a ON a.id = sj.artifact_id
      ${base.join}
      WHERE ${base.where} AND jl.status = 'failed'
      GROUP BY jl.id ORDER BY jl.created_at DESC LIMIT ?
    `).bind(...base.joinParams, ...base.whereParams, limit),
      (rows) => rows.map((r) => ({
        kind: 'run', id: r.id, artifact_id: r.artifact_id, artifact_name: r.artifact_name,
        slug: r.slug, actor: null, actor_picture: null,
        summary: `${r.title || `${r.action} schedule`} failed${r.error ? ` · ${trim140(r.error)}` : ''}`, ts: r.ts,
      })));
  }

  // Every source above must yield `ts` as unix seconds (INTEGER). Returning a raw
  // TEXT timestamp makes `y.ts - x.ts` NaN, which the sort silently treats as "equal"
  // — the rows then come out in source order, not time order.
  const settled = sources.length ? await env.DB.batch(sources) : [];
  const events: ActivityEvent[] = settled.flatMap((res, i) => tag[i](res.results || []));
  events.sort((x, y) => y.ts - x.ts);
  return events.slice(0, limit);
}
