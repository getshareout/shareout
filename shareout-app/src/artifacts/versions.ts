/**
 * Published version history, version source, restore, and production rollback.
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { promoteVersion } from '../publish/deployment';
import { runPostPublishTests } from '../tests/block-gate';
import { requireRole } from './roles';
import { json } from './json-response';
import { isTextMime } from './files';
import { invalidateDeploymentCache } from '../serve/deployment-cache';
import { normalizeVersionMessage } from './version-summary';

/** How a version came to be: `versions.source`. Null on versions written before it existed. */
export const VERSION_SOURCES = ['api', 'agent', 'editor', 'restore'] as const;
export type VersionSource = (typeof VERSION_SOURCES)[number];

/** `agent` for a service-account token, `api` for a person's token or session. */
export function publishSource(user: AuthUser): VersionSource {
  return user.service ? 'agent' : 'api';
}

const SOURCE_MAX_BYTES = 512 * 1024;

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
    SELECT v.id, v.version_no, v.entrypoint, v.created_at, v.source, v.message, v.message_source,
           u.email AS created_by_email, u.name AS created_by_name,
           rv.version_no AS restored_from_version_no,
           (SELECT a.size_bytes FROM assets a WHERE a.version_id = v.id AND a.path = v.entrypoint) AS size_bytes
    FROM versions v
    LEFT JOIN users u ON u.id = v.created_by
    LEFT JOIN versions rv ON rv.id = v.restored_from_version_id
    WHERE v.artifact_id = ?
    ORDER BY v.version_no DESC
    LIMIT 50
  `).bind(artifactId).all<{
    id: string;
    version_no: number;
    entrypoint: string;
    created_at: string;
  }>();

  const live = await env.DB.prepare(
    "SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'production'"
  ).bind(artifactId).first<{ version_id: string }>();

  return json({ versions: versions.results || [], live_version_id: live?.version_id ?? null });
}

/** GET /v1/artifacts/:id/versions/:no/source — the entrypoint text of one version, for diff and preview. */
export async function handleGetVersionSource(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string,
  versionNo: number
): Promise<Response> {
  const forbidden = await requireRole(env, artifactId, user.id, 'viewer');
  if (forbidden) return forbidden;

  const version = await env.DB.prepare(
    'SELECT id, version_no, entrypoint FROM versions WHERE artifact_id = ? AND version_no = ?'
  ).bind(artifactId, versionNo).first<{ id: string; version_no: number; entrypoint: string }>();
  if (!version) return json({ error: 'Version not found', code: 'VERSION_NOT_FOUND' }, 404);

  const asset = await env.DB.prepare(
    'SELECT r2_key, mime, size_bytes FROM assets WHERE version_id = ? AND path = ?'
  ).bind(version.id, version.entrypoint).first<{ r2_key: string; mime: string; size_bytes: number }>();
  const obj = asset ? await env.ARTIFACTS.get(asset.r2_key) : null;
  if (!asset || !obj) return json({ error: 'Version content not found', code: 'ASSET_NOT_FOUND' }, 404);
  if (!isTextMime(asset.mime)) {
    return json({ error: 'This version has no text source to show', code: 'NOT_TEXT' }, 415);
  }

  const text = await obj.text();
  const truncated = text.length > SOURCE_MAX_BYTES;
  return json({
    version_no: version.version_no,
    entrypoint: version.entrypoint,
    mime: asset.mime,
    size_bytes: asset.size_bytes,
    content: truncated ? text.slice(0, SOURCE_MAX_BYTES) : text,
    truncated,
  });
}

/**
 * POST /v1/artifacts/:id/versions/:no/restore — non-destructive restore: a new head
 * version whose files are the old version's (same R2 objects), then promoted like a
 * publish. Every earlier version stays in the history.
 */
export async function handleRestoreVersion(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string,
  versionNo: number,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<Response> {
  const artifact = await env.DB.prepare(`
    SELECT a.id, a.workspace_id, COALESCE(d.slug, a.slug) AS slug
    FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    WHERE a.id = ? AND a.deleted_at IS NULL
  `).bind(artifactId).first<{ id: string; workspace_id: string | null; slug: string }>();
  if (!artifact) return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);

  const forbidden = await requireRole(env, artifactId, user.id, 'editor');
  if (forbidden) return forbidden;

  let body: { message?: unknown } = {};
  const raw = await request.text();
  if (raw.trim()) {
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }
  }
  const message = normalizeVersionMessage(body.message);

  const target = await env.DB.prepare(
    'SELECT id, version_no, entrypoint, mobile_entrypoint, manifest_json FROM versions WHERE artifact_id = ? AND version_no = ?'
  ).bind(artifactId, versionNo).first<{
    id: string; version_no: number; entrypoint: string; mobile_entrypoint: string | null; manifest_json: string | null;
  }>();
  if (!target) return json({ error: 'Version not found', code: 'VERSION_NOT_FOUND' }, 404);
  const entry = await env.DB.prepare('SELECT 1 FROM assets WHERE version_id = ? AND path = ?')
    .bind(target.id, target.entrypoint).first();
  if (!entry) return json({ error: 'That version has no files to restore', code: 'ASSET_NOT_FOUND' }, 409);

  const head = await env.DB.prepare(
    'SELECT MAX(version_no) AS max_no FROM versions WHERE artifact_id = ?'
  ).bind(artifactId).first<{ max_no: number | null }>();
  const newNo = (head?.max_no || 0) + 1;
  const newId = generateId('ver');

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO versions (id, artifact_id, version_no, entrypoint, mobile_entrypoint, manifest_json, created_at, created_by, source, message, message_source, restored_from_version_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'restore', ?, ?, ?)`
      ).bind(newId, artifactId, newNo, target.entrypoint, target.mobile_entrypoint, target.manifest_json ?? '{}',
        new Date().toISOString(), user.id, message, message ? 'author' : null, target.id),
      env.DB.prepare(
        `INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
         SELECT 'ast_' || lower(hex(randomblob(12))), ?, path, r2_key, mime, size_bytes, sha256
           FROM assets WHERE version_id = ?`
      ).bind(newId, target.id),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return json({ error: 'Someone published at the same moment. Try again.', code: 'CONFLICT' }, 409);
    }
    throw err;
  }

  const staged = await promoteVersion(env, artifactId, newId, artifact.slug);
  const testRun = runPostPublishTests(env, artifactId, artifact.workspace_id ?? '', newId, artifact.slug, staged).catch(() => {});
  if (waitUntil) waitUntil(testRun); else await testRun;

  return json({
    success: true,
    version_id: newId,
    version_no: newNo,
    restored_from_version_no: target.version_no,
    staged,
  }, 201);
}

/** RFC 9745 `Deprecation` date for the pointer-move rollback (2026-10-16). */
const ROLLBACK_DEPRECATED_AT = '@1792108800';

/**
 * POST /v1/artifacts/:id/rollback — DEPRECATED pointer move, kept for old clients.
 * Use POST /v1/artifacts/:id/versions/:no/restore, which keeps the history.
 */
export async function handleRollback(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const res = await rollbackPointer(request, env, user, artifactId);
  res.headers.set('Deprecation', ROLLBACK_DEPRECATED_AT);
  res.headers.set('Link', `</v1/skill/api/artifacts.md#versions--restore>; rel="deprecation"`);
  return res;
}

async function rollbackPointer(
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

  await invalidateDeploymentCache(env, artifact.slug, artifactId);

  return json({
    success: true,
    deployed_version: targetVersion.version_no,
    version_id: targetVersion.id,
  });
}
