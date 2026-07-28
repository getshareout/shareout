/**
 * User favorites for artifacts (per-user bookmarks).
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { requireRole } from './roles';
import { json } from './json-response';

export async function handleAddFavorite(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id, visibility FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ id: string; visibility: string }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  // Any logged-in user can favorite an artifact they can view. Private
  // artifacts still require viewer access; public artifacts are open.
  if (artifact.visibility === 'private') {
    const forbidden = await requireRole(env, artifactId, user.id, 'viewer');
    if (forbidden) return forbidden;
  }

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
