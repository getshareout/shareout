/**
 * Review and sharing notifications. Each one goes through notifyUser (feed + email +
 * Telegram under the recipient's preferences) and never reaches whoever caused it.
 *
 *  - Version approved → the artifact's owner, once per approver per version.
 *  - An outside person opens something in a shared folder → whoever shared that folder
 *    with them, once per person per folder per UTC day.
 *  - New versions → followers and collaborators (and the owner), once publishing has been
 *    quiet for VERSION_QUIET_MS; an hourly sweep sends one notice per artifact covering
 *    every version since the last one, each with its note (the author's or the AI's).
 *  - A folder newly shared with an outside person who already has an account → them,
 *    linking to /shared?folder=<id> (new people get the invite email instead).
 */
import type { Env } from '../types';
import { getPlatformOrigin } from '../config/origins';
import { claimEmailSend } from '../email/email-log';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { canViewArtifact } from '../data/middleware';
import { normalizeVisibility } from '../visibility-config';
import { t } from '../i18n';
import { NOTIFY_TG } from './copy';
import { artifactLink, displayName, notifyUser } from './deliver';

export const VERSION_QUIET_MS = 10 * 60 * 1000;
const VERSION_LOOKBACK_MS = 26 * 60 * 60 * 1000;
const VERSION_RECIPIENT_CAP = 200;

// ── 1. approvals ────────────────────────────────────────────────────────────

export async function notifyVersionApproved(
  env: Env,
  opts: { artifactId: string; versionId: string; approverId: string; approverIds: string[] },
): Promise<void> {
  try {
    const base = getPlatformOrigin(env);
    const art = await artifactLink(env, base, opts.artifactId);
    if (!art?.ownerId || opts.approverIds.includes(art.ownerId)) return;
    if (!(await claimEmailSend(env, 'version_approved', `${opts.versionId}:${opts.approverId}`))) return;
    const v = await env.DB.prepare('SELECT version_no FROM versions WHERE id = ?').bind(opts.versionId).first<{ version_no: number }>();
    const approverName = await displayName(env, opts.approverId);
    const versionNo = v?.version_no ?? null;
    await notifyUser(env, {
      userId: art.ownerId, actorIds: opts.approverIds, workspaceId: art.workspaceId,
      email: { type: 'version_approved', data: { approverName, title: art.title, versionNo, url: art.url } },
      telegram: (l) => `${t(l, NOTIFY_TG).approved(approverName, art.title, versionNo)}\n\n${art.url}`,
      feed: {
        kind: 'version_approved', subjectType: 'artifact', subjectId: opts.artifactId,
        payload: { artifact_name: art.title, slug: art.slug, actor: approverName, version_no: versionNo },
      },
    });
  } catch { /* best-effort */ }
}

// ── 2. first open of a shared folder ───────────────────────────────────────

interface SharedFolder { folder_id: string; folder_name: string; granted_by: string }

/** The nearest folder above `artifactId` shared with `userId` (directly or via their client), if any. */
async function sharedFolderFor(env: Env, workspaceId: string, artifactId: string, userId: string): Promise<SharedFolder | null> {
  return env.DB.prepare(`
    WITH RECURSIVE up(id, parent_id, depth) AS (
      SELECT f.id, f.parent_id, 0 FROM artifacts a JOIN folders f ON f.id = a.folder_id WHERE a.id = ?
      UNION ALL
      SELECT f.id, f.parent_id, up.depth + 1 FROM folders f JOIN up ON f.id = up.parent_id WHERE up.depth < 32
    )
    SELECT g.resource_id AS folder_id, fo.name AS folder_name, g.granted_by AS granted_by
      FROM grants g
      JOIN up ON g.resource_type = 'folder' AND g.resource_id = up.id
      JOIN folders fo ON fo.id = g.resource_id
     WHERE g.workspace_id = ?
       AND (g.expires_at IS NULL OR g.expires_at > ?)
       AND ((g.subject_type = 'external_user' AND g.subject_id = ?)
         OR (g.subject_type = 'sharee' AND g.subject_id IN
              (SELECT sharee_id FROM sharee_members WHERE user_id = ? AND status != 'removed')))
     ORDER BY up.depth ASC, g.created_at DESC
     LIMIT 1
  `).bind(artifactId, workspaceId, new Date().toISOString(), userId, userId).first<SharedFolder>();
}

export async function notifyFolderFirstOpen(
  env: Env,
  opts: { workspaceId: string; userId: string; artifactId: string; now?: number },
): Promise<void> {
  try {
    const folder = await sharedFolderFor(env, opts.workspaceId, opts.artifactId, opts.userId);
    if (!folder || folder.granted_by === opts.userId) return;
    if (!(await getInternalWorkspaceRole(env, opts.workspaceId, folder.granted_by))) return;
    const day = new Date(opts.now ?? Date.now()).toISOString().slice(0, 10);
    if (!(await claimEmailSend(env, 'folder_first_open', `${folder.folder_id}:${opts.userId}:${day}`))) return;
    const base = getPlatformOrigin(env);
    const art = await artifactLink(env, base, opts.artifactId);
    const viewer = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(opts.userId).first<{ email: string | null }>();
    const viewerEmail = viewer?.email || 'Someone';
    const itemName = art?.title ?? 'an artifact';
    const url = `${base}/home#l/artifacts/${encodeURIComponent(folder.folder_id)}`;
    await notifyUser(env, {
      userId: folder.granted_by, actorIds: [opts.userId], workspaceId: opts.workspaceId,
      email: { type: 'folder_first_open', data: { viewerEmail, folderName: folder.folder_name, itemName, url } },
      telegram: (l) => `${t(l, NOTIFY_TG).folderOpened(viewerEmail, itemName, folder.folder_name)}\n\n${url}`,
      feed: {
        kind: 'folder_first_open', subjectType: 'artifact', subjectId: opts.artifactId,
        payload: { artifact_name: itemName, slug: art?.slug ?? null, actor: viewerEmail, folder_id: folder.folder_id, folder_name: folder.folder_name },
      },
    });
  } catch { /* best-effort */ }
}

// ── 3. new versions, debounced ─────────────────────────────────────────────

interface VersionRow { id: string; artifact_id: string; version_no: number; message: string | null; created_by: string | null; created_at: string }

/** Followers (an artifact follow on their profile), collaborators with an account, and the owner. */
async function versionAudience(env: Env, artifactId: string, ownerId: string | null): Promise<Array<{ id: string; email: string | null }>> {
  const { results } = await env.DB.prepare(`
    SELECT u.id, u.email FROM users u WHERE u.id IN (
      SELECT p.user_id FROM user_profiles p, json_each(p.follows) f
       WHERE json_valid(p.follows) AND json_extract(f.value, '$.kind') = 'artifact' AND json_extract(f.value, '$.ref') = ?
      UNION
      SELECT u2.id FROM collaborators c JOIN users u2 ON lower(u2.email) = lower(c.email) WHERE c.artifact_id = ?
      UNION
      SELECT ? WHERE ? IS NOT NULL
    ) LIMIT ?
  `).bind(artifactId, artifactId, ownerId, ownerId, VERSION_RECIPIENT_CAP).all<{ id: string; email: string | null }>();
  return results || [];
}

/**
 * Hourly: for each artifact with unannounced versions (version 2+, last day) whose newest
 * version is older than VERSION_QUIET_MS, claim those versions and send ONE notice per
 * recipient. A version claimed here is never announced again; one still inside the quiet
 * window waits for the next run.
 */
export async function runVersionNoticeSweep(env: Env, now = Date.now()): Promise<{ notified: number }> {
  let notified = 0;
  try {
    const since = new Date(now - VERSION_LOOKBACK_MS).toISOString();
    const { results } = await env.DB.prepare(`
      SELECT v.id, v.artifact_id, v.version_no, v.message, v.created_by, v.created_at
        FROM versions v JOIN artifacts a ON a.id = v.artifact_id
       WHERE v.created_at >= ? AND v.version_no > 1 AND a.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.type = 'version_notice' AND l.key = v.id)
       ORDER BY v.artifact_id, v.version_no
       LIMIT 500
    `).bind(since).all<VersionRow>();
    const byArtifact = new Map<string, VersionRow[]>();
    for (const r of results || []) {
      const list = byArtifact.get(r.artifact_id) ?? [];
      list.push(r);
      byArtifact.set(r.artifact_id, list);
    }
    const base = getPlatformOrigin(env);
    for (const [artifactId, rows] of byArtifact) {
      const newest = rows.reduce((m, r) => (r.created_at > m ? r.created_at : m), '');
      if (Date.parse(newest) > now - VERSION_QUIET_MS) continue;
      const claimed: VersionRow[] = [];
      for (const r of rows) if (await claimEmailSend(env, 'version_notice', r.id)) claimed.push(r);
      if (!claimed.length) continue;
      notified += await announceVersions(env, base, artifactId, claimed);
    }
  } catch { /* best-effort: the next run picks up whatever was not claimed */ }
  return { notified };
}

async function announceVersions(env: Env, base: string, artifactId: string, versions: VersionRow[]): Promise<number> {
  const art = await artifactLink(env, base, artifactId);
  if (!art) return 0;
  const actorIds = [...new Set(versions.map((v) => v.created_by).filter((x): x is string => !!x))];
  const latest = versions.reduce((m, v) => (v.version_no > m.version_no ? v : m), versions[0]);
  const publisherName = await displayName(env, latest.created_by);
  const list = versions.map((v) => ({ no: v.version_no, note: v.message?.trim() || null }));
  const isPublic = normalizeVisibility(art.visibility) === 'public';
  const artRow = { id: artifactId, visibility: art.visibility, workspace_id: art.workspaceId, owner_id: art.ownerId };
  let sent = 0;
  for (const r of await versionAudience(env, artifactId, art.ownerId)) {
    if (actorIds.includes(r.id)) continue;
    if (!isPublic && !(await canViewArtifact(env, artRow, r.id, r.email))) continue;
    await notifyUser(env, {
      userId: r.id, actorIds, workspaceId: art.workspaceId,
      email: { type: 'version_published', data: { title: art.title, url: art.url, publisherName, versions: list } },
      telegram: (l) => `${t(l, NOTIFY_TG).newVersion(art.title, latest.version_no, list.length)}${latest.message ? `:\n\n${latest.message}` : ''}\n\n${art.url}`,
      feed: {
        kind: 'version_published', subjectType: 'artifact', subjectId: artifactId,
        payload: { artifact_name: art.title, slug: art.slug, actor: publisherName, version_no: latest.version_no, note: latest.message ?? null, count: list.length },
      },
    });
    sent++;
  }
  return sent;
}

// ── 4. a folder newly shared with an existing outside person ───────────────

export async function notifyFolderShared(
  env: Env,
  opts: { workspaceId: string; folderId: string; grantedBy: string; subjectType: string; subjectId: string },
): Promise<void> {
  try {
    const folder = await env.DB.prepare('SELECT f.name, w.name AS ws_name FROM folders f JOIN workspaces w ON w.id = f.workspace_id WHERE f.id = ? AND f.workspace_id = ?')
      .bind(opts.folderId, opts.workspaceId).first<{ name: string; ws_name: string }>();
    if (!folder) return;
    // Active accounts only: someone who never signed in gets the invite email, which
    // already carries the folder link.
    const { results } = opts.subjectType === 'sharee'
      ? await env.DB.prepare(`
          SELECT u.id FROM sharee_members sm JOIN users u ON u.id = sm.user_id
           WHERE sm.sharee_id = ? AND sm.status != 'removed' AND u.last_login_at IS NOT NULL`).bind(opts.subjectId).all<{ id: string }>()
      : await env.DB.prepare('SELECT id FROM users WHERE id = ? AND last_login_at IS NOT NULL').bind(opts.subjectId).all<{ id: string }>();
    const sharerName = await displayName(env, opts.grantedBy);
    const url = `${getPlatformOrigin(env)}/shared?folder=${encodeURIComponent(opts.folderId)}`;
    for (const r of results || []) {
      await notifyUser(env, {
        userId: r.id, actorIds: [opts.grantedBy], workspaceId: opts.workspaceId,
        email: { type: 'folder_shared', data: { sharerName, folderName: folder.name, workspaceName: folder.ws_name, url } },
        telegram: (l) => `${t(l, NOTIFY_TG).folderShared(sharerName, folder.name)}\n\n${url}`,
      });
    }
  } catch { /* best-effort */ }
}
