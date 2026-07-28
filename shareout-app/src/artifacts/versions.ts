/**
 * Published version history and production rollback.
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { requireRole } from './roles';
import { json } from './json-response';

export async function handleGetVersions(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ id: string }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  const forbidden = await requireRole(env, artifactId, user.id, 'viewer');
  if (forbidden) return forbidden;

  const versions = await env.DB.prepare(`
    SELECT id, version_no, entrypoint, created_at
    FROM versions
    WHERE artifact_id = ?
    ORDER BY version_no DESC
    LIMIT 50
  `).bind(artifactId).all<{
    id: string;
    version_no: number;
    entrypoint: string;
    created_at: string;
  }>();

  return json({ versions: versions.results || [] });
}

export async function handleRollback(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id, slug FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ id: string; slug: string }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  const forbidden = await requireRole(env, artifactId, user.id, 'editor');
  if (forbidden) return forbidden;

  let body: { version_id?: string; version_no?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  let targetVersion: { id: string; version_no: number } | null = null;

  if (body.version_id) {
    targetVersion = await env.DB.prepare(
      'SELECT id, version_no FROM versions WHERE id = ? AND artifact_id = ?'
    ).bind(body.version_id, artifactId).first();
  } else if (body.version_no) {
    targetVersion = await env.DB.prepare(
      'SELECT id, version_no FROM versions WHERE version_no = ? AND artifact_id = ?'
    ).bind(body.version_no, artifactId).first();
  }

  if (!targetVersion) {
    return json({ error: 'Version not found', code: 'VERSION_NOT_FOUND' }, 404);
  }

  const res = await env.DB.prepare(`
    UPDATE deployments SET version_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE artifact_id = ? AND channel = 'production'
  `).bind(targetVersion.id, artifactId).run();

  if (!res.meta.changes) {
    return json({ error: 'No production deployment to roll back', code: 'NOT_DEPLOYED' }, 409);
  }

  if (env.SLUGS) {
    await env.SLUGS.delete(`deploy:${artifact.slug}`).catch(() => {});
  }

  return json({
    success: true,
    deployed_version: targetVersion.version_no,
    version_id: targetVersion.id,
  });
}
