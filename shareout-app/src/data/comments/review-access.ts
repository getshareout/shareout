import type { Env } from '../../types';
import { getVisibilityScope, placeholders, type VisibilityScope } from '../../account-links';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { canAccess } from '../../access/can-access';
import { normalizeVisibility } from '../../visibility-config';

/**
 * Comment access on an artifact — the bar for review actions (resolve, assign, approve).
 * Owner or collaborator (any role, across linked accounts), an internal member of the
 * artifact's workspace when it is workspace- or public-visible, or a 'comment' grant.
 * A view-only grant and a signed-in stranger on a public page do not qualify.
 */
export async function canReviewArtifact(
  env: Env,
  artifactId: string,
  user: { id: string; email: string | null },
  visArg?: VisibilityScope,
): Promise<boolean> {
  const art = await env.DB.prepare(
    'SELECT owner_id, visibility, workspace_id FROM artifacts WHERE id = ? AND deleted_at IS NULL'
  ).bind(artifactId).first<{ owner_id: string | null; visibility: string; workspace_id: string | null }>();
  if (!art) return false;
  const vis = visArg ?? await getVisibilityScope(env, user);
  if (art.owner_id && vis.userIds.includes(art.owner_id)) return true;
  if (vis.emails.length) {
    const collab = await env.DB.prepare(
      `SELECT 1 AS x FROM collaborators WHERE artifact_id = ? AND email IN (${placeholders(vis.emails.length)}) LIMIT 1`
    ).bind(artifactId, ...vis.emails).first();
    if (collab) return true;
  }
  const visibility = normalizeVisibility(art.visibility);
  if (art.workspace_id && (visibility === 'workspace' || visibility === 'public')) {
    const roles = await Promise.all(vis.userIds.map((uid) => getInternalWorkspaceRole(env, art.workspace_id!, uid)));
    if (roles.some((r) => !!r)) return true;
  }
  return canAccess(env, vis, 'artifact', artifactId, 'comment');
}
