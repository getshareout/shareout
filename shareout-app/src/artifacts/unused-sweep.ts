import type { Env } from '../types';
import { softDeleteArtifact, RETENTION_DAYS } from './crud';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { dispatchLifecycleEmail } from '../email/gateway';
import { claimEmailSend } from '../email/email-log';
import { logAudit } from '../audit';
import { getPlatformOrigin } from '../config/origins';

/**
 * Never-viewed janitor — anti-Drive-graveyard. Once a month per workspace, flag
 * published pages nobody has opened in 90+ days so the team can archive them
 * ("worth archiving?") instead of letting the workspace rot silently. Suggest only:
 * nothing is deleted here — archiving is an explicit one-click action that routes
 * into the existing 30-day trash (softDeleteArtifact → purgeSoftDeleted).
 *
 * Runs from the hourly scheduled handler; self-gated to at most once/30 days per
 * workspace via workspaces.last_janitor_at, so it isn't a cron time-match.
 */
const UNUSED_AGE_DAYS = 90;
const COOLDOWN_DAYS = 30;
const MIN_UNUSED = 3; // don't nag about one or two stray pages
const WORKSPACE_LIMIT = 50; // workspaces (and personal accounts) swept per run (bounds subrequests)
const SAMPLE_TITLES = 5;
// ponytail: softDeleteArtifact costs ~4-5 subrequests (2 D1 + KV invalidate + vector
// remove); 100 keeps a single archive-all well under the 1,000-subrequest Worker cap.
// A follow-up click drains the next batch (the set is recomputed server-side).
const MAX_ARCHIVE = 100;

export interface UnusedArtifact {
  id: string;
  name: string | null;
  slug: string;
}

/** Either a shared workspace's artifacts or one user's personal (workspace_id IS NULL) set. */
export type UnusedScope = { workspaceId: string } | { ownerUserId: string };

/**
 * Published (has a production deployment), non-example, non-deleted artifacts in the
 * given scope (a workspace, or a user's personal set), older than UNUSED_AGE_DAYS, with
 * ZERO recorded views in that window.
 *
 * "Unused" means untouched on EVERY signal we have, all within the window:
 *  - no analytics_daily rollup rows (the durable serve-path view history)
 *  - no un-rolled-up analytics_events (closes the "viewed today, before the daily
 *    rollup ran" gap) — both only ever gain rows on real 'view' events
 *  - no user_recent_views rows (Studio tabs / agent canvas opens don't hit the
 *    serve path, so an in-app-only page must not be flagged)
 *  - no production re-publish (deployments.updated_at) — actively-edited WIP that
 *    nobody has viewed yet is not graveyard rot
 *  - starred by anyone = explicit keeper, regardless of views
 */
export async function findUnusedArtifacts(
  env: Env,
  scope: UnusedScope,
  limit = MAX_ARCHIVE,
): Promise<UnusedArtifact[]> {
  const scopeSql = 'workspaceId' in scope
    ? 'a.workspace_id = ?'
    : 'a.workspace_id IS NULL AND a.owner_id = ?';
  const scopeBind = 'workspaceId' in scope ? scope.workspaceId : scope.ownerUserId;
  const { results } = await env.DB.prepare(`
    SELECT a.id AS id, a.name AS name, a.slug AS slug
    FROM artifacts a
    JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    WHERE ${scopeSql}
      AND a.deleted_at IS NULL
      AND a.is_example = 0
      AND a.created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-${UNUSED_AGE_DAYS} days')
      AND d.updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-${UNUSED_AGE_DAYS} days')
      AND NOT EXISTS (
        SELECT 1 FROM analytics_daily ad
        WHERE ad.artifact_id = a.id AND ad.date >= date('now', '-${UNUSED_AGE_DAYS} days') AND ad.views > 0)
      AND NOT EXISTS (
        SELECT 1 FROM analytics_events ae
        WHERE ae.artifact_id = a.id AND ae.event_type = 'view' AND ae.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-${UNUSED_AGE_DAYS} days'))
      AND NOT EXISTS (
        SELECT 1 FROM user_recent_views urv
        WHERE urv.artifact_id = a.id AND urv.viewed_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-${UNUSED_AGE_DAYS} days'))
      AND NOT EXISTS (SELECT 1 FROM favorites f WHERE f.artifact_id = a.id)
    ORDER BY a.created_at ASC
    LIMIT ?
  `).bind(scopeBind, limit).all<UnusedArtifact>();
  return results || [];
}

export async function runUnusedArtifactSweep(env: Env): Promise<{ notified: number }> {
  try {
    const { results } = await env.DB.prepare(`
      SELECT id, name FROM workspaces
      WHERE last_janitor_at IS NULL OR last_janitor_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-${COOLDOWN_DAYS} days')
      LIMIT ?
    `).bind(WORKSPACE_LIMIT).all<{ id: string; name: string | null }>();

    let notified = 0;
    for (const ws of results || []) {
      try {
        const unused = await findUnusedArtifacts(env, { workspaceId: ws.id });
        if (unused.length >= MIN_UNUSED) {
          const titles = unused.slice(0, SAMPLE_TITLES).map((u) => u.name || 'Untitled');
          await env.DB.prepare(`
            INSERT INTO notifications (id, recipient_type, recipient_id, kind, payload, created_at)
            VALUES (?, 'workspace', ?, 'unused_artifacts', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          `).bind(
            crypto.randomUUID(), ws.id,
            JSON.stringify({ artifact_count: unused.length, sample_titles: titles }),
          ).run();
          await emailAdmins(env, ws.id, ws.name, unused.length, titles).catch(() => {});
          notified++;
        }
        // Always stamp — this is the monthly gate. A sub-threshold workspace still
        // waits 30 days before it's re-swept.
        await env.DB.prepare(`UPDATE workspaces SET last_janitor_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).bind(ws.id).run();
      } catch {
        // one workspace's failure must not block the rest of the sweep
      }
    }

    // Personal accounts (workspace_id IS NULL artifacts). The EXISTS pre-filter skips
    // accounts with nothing old enough to ever flag, so they don't burn a per-run slot.
    const { results: users } = await env.DB.prepare(`
      SELECT u.id AS id, u.email AS email, u.name AS name FROM users u
      WHERE (u.last_janitor_at IS NULL OR u.last_janitor_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-${COOLDOWN_DAYS} days'))
        AND COALESCE(u.disabled, 0) = 0
        AND EXISTS (
          SELECT 1 FROM artifacts a
          WHERE a.owner_id = u.id AND a.workspace_id IS NULL AND a.deleted_at IS NULL
            AND a.is_example = 0 AND a.created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-${UNUSED_AGE_DAYS} days'))
      LIMIT ?
    `).bind(WORKSPACE_LIMIT).all<{ id: string; email: string | null; name: string | null }>();

    for (const u of users || []) {
      try {
        const unused = await findUnusedArtifacts(env, { ownerUserId: u.id });
        if (unused.length >= MIN_UNUSED) {
          const titles = unused.slice(0, SAMPLE_TITLES).map((x) => x.name || 'Untitled');
          await env.DB.prepare(`
            INSERT INTO notifications (id, recipient_type, recipient_id, kind, payload, created_at)
            VALUES (?, 'user', ?, 'unused_artifacts', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          `).bind(
            crypto.randomUUID(), u.id,
            JSON.stringify({ artifact_count: unused.length, sample_titles: titles }),
          ).run();
          await emailUser(env, u.id, u.email, unused.length, titles).catch(() => {});
          notified++;
        }
        // Always stamp — the monthly per-user gate (mirrors the workspace stamp above).
        await env.DB.prepare(`UPDATE users SET last_janitor_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).bind(u.id).run();
      } catch {
        // one user's failure must not block the rest of the sweep
      }
    }
    return { notified };
  } catch {
    // sweep must never throw out of the scheduled handler
    return { notified: 0 };
  }
}

/** Email workspace admins/owners the monthly cleanup report. Claim-guarded per
 *  workspace+month so a re-run never double-sends. */
async function emailAdmins(
  env: Env,
  workspaceId: string,
  workspaceName: string | null,
  count: number,
  titles: string[],
): Promise<void> {
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  if (!(await claimEmailSend(env, 'unused_artifacts_report', `${workspaceId}:${monthKey}`))) return;

  const admins = await env.DB.prepare(`
    SELECT wm.user_id AS id, u.email AS email
    FROM workspace_members wm JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ? AND wm.member_class = 'internal' AND wm.role IN ('owner', 'admin')
      AND u.email IS NOT NULL AND COALESCE(u.disabled, 0) = 0
  `).bind(workspaceId).all<{ id: string; email: string }>();

  const base = getPlatformOrigin(env);
  for (const a of admins.results || []) {
    await dispatchLifecycleEmail(env, {
      type: 'unused_artifacts_report',
      toUserId: a.id,
      toEmail: a.email,
      data: { workspaceName: workspaceName || 'your workspace', count, titles, homeUrl: `${base}/home` },
    }).catch(() => {});
  }
}

/** Email one user the monthly cleanup report for their personal space. Claim-guarded
 *  per user+month so a re-run never double-sends. */
async function emailUser(
  env: Env,
  userId: string,
  email: string | null,
  count: number,
  titles: string[],
): Promise<void> {
  if (!email) return;
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  if (!(await claimEmailSend(env, 'unused_artifacts_report', `user:${userId}:${monthKey}`))) return;
  const base = getPlatformOrigin(env);
  await dispatchLifecycleEmail(env, {
    type: 'unused_artifacts_report',
    toUserId: userId,
    toEmail: email,
    data: { workspaceName: 'your personal space', count, titles, homeUrl: `${base}/home` },
  }).catch(() => {});
}

interface AuthUser { id: string; email: string | null }

/**
 * One-click "archive all" for the janitor card / email. Owner-or-admin only;
 * recomputes the unused set at click time (never a stale kill-list) and soft-deletes
 * each into the existing 30-day trash — fully recoverable, then auto-purged by
 * purgeSoftDeleted. No new delete path.
 */
export async function handleArchiveUnusedArtifacts(
  env: Env,
  user: AuthUser,
  workspaceId: string,
): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (role !== 'owner' && role !== 'admin') {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const unused = await findUnusedArtifacts(env, { workspaceId });
  let archived = 0;
  for (const a of unused) {
    try {
      await softDeleteArtifact(env, a.id, a.slug);
      archived++;
    } catch {
      // one artifact's failure must not block the rest
    }
  }
  const maybeMore = unused.length === MAX_ARCHIVE; // batch was full — another click drains the rest
  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'unused.archive_all', targetType: 'workspace', targetId: workspaceId,
    detail: { archived },
  }).catch(() => {});
  return json({
    archived,
    may_have_more: maybeMore,
    retention_days: RETENTION_DAYS,
    message: `Archived ${archived} unused page${archived === 1 ? '' : 's'} to trash. Recoverable for ${RETENTION_DAYS} days.${maybeMore ? ' More may remain — run again to continue.' : ''}`,
  });
}

/**
 * Personal "archive all" — the same one-click sweep for the signed-in user's own
 * unopened pages (workspace_id IS NULL). No role check: you can only ever archive your
 * own artifacts. Recomputed at click time, soft-deleted into the existing 30-day trash.
 */
export async function handleArchivePersonalUnused(env: Env, user: AuthUser): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  const unused = await findUnusedArtifacts(env, { ownerUserId: user.id });
  let archived = 0;
  for (const a of unused) {
    try {
      await softDeleteArtifact(env, a.id, a.slug);
      archived++;
    } catch {
      // one artifact's failure must not block the rest
    }
  }
  const maybeMore = unused.length === MAX_ARCHIVE;
  await logAudit(env, {
    workspaceId: null, actorId: user.id, actorEmail: user.email,
    action: 'unused.archive_all', targetType: 'user', targetId: user.id,
    detail: { archived },
  }).catch(() => {});
  return json({
    archived,
    may_have_more: maybeMore,
    retention_days: RETENTION_DAYS,
    message: `Archived ${archived} unused page${archived === 1 ? '' : 's'} to trash. Recoverable for ${RETENTION_DAYS} days.${maybeMore ? ' More may remain — run again to continue.' : ''}`,
  });
}
