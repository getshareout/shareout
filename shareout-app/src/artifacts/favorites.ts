/**
 * User favorites for artifacts (per-user bookmarks).
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { getUserRole } from './roles';
import { canViewArtifact } from '../data/middleware';
import { normalizeVisibility } from '../visibility-config';
import { json } from './json-response';

export async function handleAddFavorite(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id, visibility, workspace_id, owner_id FROM artifacts WHERE id = ? AND deleted_at IS NULL'
  ).bind(artifactId).first<{ id: string; visibility: string; workspace_id: string | null; owner_id: string | null }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  // Favorites are per-user, so view access is the gate: public artifacts are open;
  // closed ones need a role, workspace membership (workspace-visible) or a grant.
  const canView = normalizeVisibility(artifact.visibility) === 'public' ||
    !!(await getUserRole(env, artifactId, user.id)) ||
    await canViewArtifact(env, artifact, user.id, user.email ?? null);
  if (!canView) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  await env.DB.prepare(
    'INSERT OR IGNORE INTO favorites (id, artifact_id, user_id) VALUES (?, ?, ?)'
  ).bind(generateId('fav'), artifactId, user.id).run();

  return json({ success: true, artifact_id: artifactId, favorited: true });
}

export async function handleRemoveFavorite(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  await env.DB.prepare(
    'DELETE FROM favorites WHERE artifact_id = ? AND user_id = ?'
  ).bind(artifactId, user.id).run();

  return json({ success: true, artifact_id: artifactId, favorited: false });
}
