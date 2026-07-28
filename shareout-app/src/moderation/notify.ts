import type { Env } from '../types';
import { dispatchLifecycleEmail } from '../email/gateway';
import { getPlatformOrigin } from '../config/origins';

/**
 * Notify a page owner that a moderation hold resolved (Workstream C). Inserts a row
 * the Home bell reads (kind 'moderation'), and — for 'approved' only — sends the
 * "passed review" lifecycle email (blocked stays bell-only: rare + admin-driven).
 *
 * Fired at the single approve chokepoint (restoreHeldVisibility) and the block path
 * (setArtifactModeration). Best-effort: callers wrap in .catch(), and every side
 * effect here is independently swallowed so one failure never blocks the other.
 */
export async function notifyModerationResolved(
  env: Env,
  artifactId: string,
  event: 'approved' | 'blocked',
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT a.owner_id AS owner_id, a.name AS name, COALESCE(d.slug, a.slug) AS slug
       FROM artifacts a
       LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      WHERE a.id = ?`
  ).bind(artifactId).first<{ owner_id: string | null; name: string | null; slug: string | null }>();
  if (!row?.owner_id) return;

  await env.DB.prepare(
    `INSERT INTO notifications (id, recipient_type, recipient_id, kind, subject_type, subject_id, payload)
     VALUES (?, 'user', ?, 'moderation', 'artifact', ?, ?)`
  ).bind(
    crypto.randomUUID(), row.owner_id, artifactId,
    JSON.stringify({ event, artifact_name: row.name, slug: row.slug }),
  ).run().catch(() => {});

  if (event === 'approved') {
    const baseUrl = getPlatformOrigin(env);
    const url = row.slug ? `${baseUrl}/a/${encodeURIComponent(row.slug)}/` : `${baseUrl}/home`;
    await dispatchLifecycleEmail(env, {
      type: 'moderation_approved',
      toUserId: row.owner_id,
      data: { pageName: row.name || 'your page', url },
    }).catch(() => {});
  }
}
