import type { Env, Visibility } from '../types';
import { purgeArtifact } from '../artifacts';
import { clearModerationHold, restoreHeldVisibility } from '../moderation/check';
import { notifyModerationResolved } from '../moderation/notify';
import { invalidateDeploymentCacheById } from '../serve/deployment-cache';
import { setModeration } from '../artifacts/satellites';

export interface AdminArtifactRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  visibility: string;
  paused: number;
  owner: string;
  views: number;
  createdAt: string;
}

const VALID_VISIBILITY: Visibility[] = ['public', 'workspace', 'private'];

export async function searchArtifacts(
  env: Env,
  search: string,
  limit = 50,
  offset = 0
): Promise<{ artifacts: AdminArtifactRow[]; total: number }> {
  const where = search ? 'WHERE a.name LIKE ?1 OR a.slug LIKE ?1' : '';
  const like = `%${search}%`;

  const totalStmt = env.DB.prepare(`SELECT COUNT(*) AS n FROM artifacts a ${where}`);
  const total = (await (search ? totalStmt.bind(like) : totalStmt).first<{ n: number }>())?.n ?? 0;

  const stmt = env.DB.prepare(
    `SELECT a.id, a.name, COALESCE(dep.slug, a.slug) AS slug, a.artifact_type AS type, a.visibility, a.paused,
            COALESCE(u.email, u.name, 'unknown') AS owner,
            COALESCE((SELECT SUM(d.views) FROM analytics_daily d WHERE d.artifact_id = a.id),0) AS views,
            a.created_at AS createdAt
     FROM artifacts a
     LEFT JOIN users u ON u.id = a.owner_id
     LEFT JOIN deployments dep ON dep.artifact_id = a.id AND dep.channel = 'production'
     ${where}
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`
  );
  const bound = search ? stmt.bind(like, limit, offset) : stmt.bind(limit, offset);
  const rows = await bound.all<AdminArtifactRow>();
  return { artifacts: rows.results || [], total };
}

export async function setArtifactPaused(env: Env, id: string, paused: boolean): Promise<void> {
  await env.DB.prepare('UPDATE artifacts SET paused = ? WHERE id = ?')
    .bind(paused ? 1 : 0, id)
    .run();
  await invalidateDeploymentCacheById(env, id);
}

export async function setArtifactVisibility(
  env: Env,
  id: string,
  visibility: string
): Promise<{ ok: boolean; error?: string }> {
  if (!VALID_VISIBILITY.includes(visibility as Visibility)) {
    return { ok: false, error: `visibility must be one of ${VALID_VISIBILITY.join(', ')}` };
  }
  await env.DB.prepare('UPDATE artifacts SET visibility = ? WHERE id = ?').bind(visibility, id).run();
  // Admin explicitly set a non-public visibility: drop any held-from-public marker so
  // a later re-classify can't restore the page to public over this decision.
  if (visibility !== 'public') await clearModerationHold(env, id);
  await invalidateDeploymentCacheById(env, id);
  return { ok: true };
}

export interface ModerationQueueRow {
  id: string;
  name: string;
  slug: string;
  owner: string;
  workspace: string | null;
  moderation_status: string;
  moderation_reason: string | null;
  moderation_checked_at: string | null;
}

/** Artifacts awaiting human review or already blocked (Workstream B review queue). */
export async function listModerationQueue(env: Env, limit = 100): Promise<ModerationQueueRow[]> {
  const rows = await env.DB.prepare(
    `SELECT a.id, a.name, COALESCE(dep.slug, a.slug) AS slug,
            COALESCE(u.email, u.name, 'unknown') AS owner, a.workspace_id AS workspace,
            m.status AS moderation_status, m.reason AS moderation_reason,
            m.checked_at AS moderation_checked_at
       FROM artifact_moderation m
       JOIN artifacts a ON a.id = m.artifact_id
       LEFT JOIN users u ON u.id = a.owner_id
       LEFT JOIN deployments dep ON dep.artifact_id = a.id AND dep.channel = 'production'
      WHERE m.status != 'approved'
      ORDER BY m.checked_at DESC
      LIMIT ?`
  ).bind(limit).all<ModerationQueueRow>();
  return rows.results || [];
}

/**
 * Resolve a moderation review (Workstream B). 'approve' clears the hold (status
 * approved); the owner can then make it public, which will stick because
 * classifyAndPersist skips unchanged-approved content. 'block' is a takedown:
 * status blocked + paused so the serve gate returns the takedown page.
 */
export async function setArtifactModeration(
  env: Env,
  id: string,
  action: 'approve' | 'block',
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  const exists = await env.DB.prepare(
    `SELECT COALESCE(m.status, 'approved') AS moderation_status
       FROM artifacts a LEFT JOIN artifact_moderation m ON m.artifact_id = a.id
      WHERE a.id = ?`
  ).bind(id).first<{ moderation_status: string | null }>();
  if (!exists) return { ok: false, error: 'Artifact not found' };

  const now = new Date().toISOString();
  if (action === 'approve') {
    await setModeration(env, id, { status: 'approved', reason: reason ?? null, checked_at: now });
    await restoreHeldVisibility(env, id);
  } else {
    await setModeration(env, id, {
      status: 'blocked', reason: reason ?? 'blocked by review', checked_at: now,
    });
    await env.DB.prepare('UPDATE artifacts SET paused = 1 WHERE id = ?').bind(id).run();
    // Notify the owner (bell only) once per transition into blocked, not on every
    // re-block (abuse-report re-runs, re-scan) of an already-blocked page.
    if (exists.moderation_status !== 'blocked') {
      await notifyModerationResolved(env, id, 'blocked').catch(() => {});
    }
  }
  await invalidateDeploymentCacheById(env, id);
  return { ok: true };
}

export async function deleteArtifactAdmin(env: Env, id: string): Promise<{ ok: boolean; error?: string }> {
  const a = await env.DB.prepare('SELECT id, slug FROM artifacts WHERE id = ?')
    .bind(id)
    .first<{ id: string; slug: string }>();
  if (!a) return { ok: false, error: 'Artifact not found' };
  await purgeArtifact(env, a.id, a.slug);
  return { ok: true };
}
