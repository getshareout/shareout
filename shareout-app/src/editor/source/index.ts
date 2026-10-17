// ShareOut Source Editor — request handlers for non-HTML artifact editing.

import type { Env, ArtifactType, TypeMetadata } from '../../types';
import type { EditorContext } from '../index';
import { generateId, sha256 } from '../../crypto-utils';
import { invalidateDeploymentCache } from '../../serve/deployment-cache';
import { generateTypeMetadata } from '../../validation';
import { generateSourceEditorPage, type SourceEditableType } from './page';
import { shouldBlockPublish, runPostPublishTests } from '../../tests/block-gate';
import { normalizeVersionMessage, scheduleVersionSummary } from '../../artifacts/version-summary';
import { carriedManifestJson } from '../../mcp-broker/capabilities';

export const SOURCE_EDITABLE_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  'markdown',
  'txt',
  'json',
  'csv',
]);

export function isSourceEditable(type: ArtifactType): type is SourceEditableType {
  return SOURCE_EDITABLE_TYPES.has(type);
}

const DEFAULT_MIME: Record<SourceEditableType, string> = {
  markdown: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  csv: 'text/csv',
};

interface CurrentSource {
  entrypoint: string;
  /** The file being edited: the entrypoint, or one sheet of an imported workbook. */
  file: string;
  mime: string;
  content: string;
  versionNo: number;
  versionId: string | null;
}

/** One sheet of an imported workbook, by 1-based number (?sheet=2, as the viewer
 *  links it) or by asset path — null unless it is one of this artifact's sheets. */
export function sheetPath(meta: string | null, ref: string | null | undefined): string | null {
  if (!ref) return null;
  try {
    const sheets = (JSON.parse(meta || '{}') as TypeMetadata).source?.sheets || [];
    if (/^\d+$/.test(ref)) return sheets[Number(ref) - 1]?.path ?? null;
    return sheets.some((s) => s.path === ref) ? ref : null;
  } catch { return null; }
}

async function loadCurrentSource(
  env: Env,
  artifactId: string,
  type: SourceEditableType,
  path?: string | null,
): Promise<CurrentSource> {
  const row = await env.DB.prepare(`
    SELECT v.id AS version_id, v.entrypoint, v.version_no
    FROM deployments d
    JOIN versions v ON v.id = d.version_id
    WHERE d.artifact_id = ? AND d.channel = 'production'
  `).bind(artifactId).first<{ version_id: string; entrypoint: string | null; version_no: number | null }>();

  const entrypoint = row?.entrypoint || `index.${type === 'markdown' ? 'md' : type}`;
  const file = path || entrypoint;
  let mime = DEFAULT_MIME[type];
  let content = '';

  if (row?.entrypoint) {
    const asset = await env.DB.prepare(
      'SELECT r2_key, mime FROM assets WHERE version_id = ? AND path = ?'
    ).bind(row.version_id, file).first<{ r2_key: string; mime: string }>();
    if (asset) {
      if (asset.mime) mime = asset.mime;
      const obj = await env.ARTIFACTS.get(asset.r2_key);
      if (obj) content = await obj.text();
    }
  }

  return { entrypoint, file, mime, content, versionNo: row?.version_no || 0, versionId: row?.version_id ?? null };
}

export async function serveSourceEditorPage(
  env: Env,
  artifact: { id: string; slug: string; name: string | null; artifact_type: ArtifactType },
  type: SourceEditableType,
  baseUrl: string,
  sheet?: string | null,
): Promise<Response> {
  const meta = sheet
    ? await env.DB.prepare('SELECT type_metadata FROM artifacts WHERE id = ?').bind(artifact.id).first<{ type_metadata: string | null }>()
    : null;
  const current = await loadCurrentSource(env, artifact.id, type, sheetPath(meta?.type_metadata ?? null, sheet));

  const html = generateSourceEditorPage({
    artifactId: artifact.id,
    slug: artifact.slug,
    name: artifact.name || artifact.slug,
    type,
    entrypoint: current.file,
    path: current.file === current.entrypoint ? null : current.file,
    content: current.content,
    baseUrl,
    versionNo: current.versionNo,
  });

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

// Routes: source/publish (POST). Reuses the editor access checks from handleEditor.
export async function handleSourceEditor(
  request: Request,
  ctx: EditorContext,
  subAction: string
): Promise<Response> {
  if (subAction === 'publish' && request.method === 'POST') {
    return handleSourcePublish(request, ctx);
  }
  return errorResponse('NOT_FOUND', `Unknown source editor action: ${subAction}`, 404);
}

async function handleSourcePublish(request: Request, ctx: EditorContext): Promise<Response> {
  const { artifactId, env } = ctx;

  try {
    const body = await request.json() as { content?: string; path?: string; message?: string };
    if (typeof body.content !== 'string') {
      return errorResponse('INVALID_REQUEST', 'content required', 400);
    }

    const artifact = await env.DB.prepare(
      `SELECT id, name, slug, workspace_id, artifact_type, type_metadata FROM artifacts WHERE id = ?`
    ).bind(artifactId).first<{ id: string; name: string; slug: string; workspace_id: string | null; artifact_type: ArtifactType; type_metadata: string | null }>();

    if (!artifact) {
      return errorResponse('ARTIFACT_NOT_FOUND', 'Artifact not found', 404);
    }
    if (!isSourceEditable(artifact.artifact_type)) {
      return errorResponse('UNSUPPORTED', 'This artifact type is not source-editable', 400);
    }
    if (artifact.artifact_type === 'json') {
      try { JSON.parse(body.content); } catch {
        return errorResponse('VALIDATION_ERROR', 'content is not valid JSON', 400);
      }
    }

    // Artifact Tests BLOCK gate (see specs §3, §11): stage as a candidate when tests
    // block and a passing baseline exists; otherwise publish live. Never goes dark.
    const blocking = await shouldBlockPublish(env, artifactId);
    const channel = blocking ? 'candidate' : 'production';

    const type = artifact.artifact_type;
    const sheet = sheetPath(artifact.type_metadata, body.path);
    if (body.path && !sheet) return errorResponse('VALIDATION_ERROR', 'path is not a sheet of this artifact', 400);
    const current = await loadCurrentSource(env, artifactId, type, sheet);
    const entrypoint = current.entrypoint;
    const file = current.file;
    const mime = current.mime;

    const currentVersion = await env.DB.prepare(
      `SELECT MAX(version_no) as max_version FROM versions WHERE artifact_id = ?`
    ).bind(artifactId).first<{ max_version: number | null }>();
    const newVersionNo = (currentVersion?.max_version || 0) + 1;

    const versionId = generateId('ver');
    const assetId = generateId('ast');
    const deploymentId = generateId('dep');
    const message = normalizeVersionMessage(body.message);

    const bytes = new TextEncoder().encode(body.content);
    const hash = await sha256(bytes.buffer as ArrayBuffer);
    const r2Key = `${artifactId}/${versionId}/${file}`;
    await env.ARTIFACTS.put(r2Key, body.content, {
      httpMetadata: { contentType: mime },
      customMetadata: { sha256: hash },
    });

    // Keep an imported file's original + sheet list; a sheet edit leaves the entry's metadata.
    let prevMeta: TypeMetadata = {};
    try { prevMeta = JSON.parse(artifact.type_metadata || '{}') as TypeMetadata; } catch { /* rebuilt below */ }
    const typeMetadata = JSON.stringify(file === entrypoint
      ? { ...generateTypeMetadata(type, body.content, mime), ...(prevMeta.source ? { source: prevMeta.source } : {}) }
      : prevMeta);

    // Editor saves keep the live version's runtime capabilities (MCP grants).
    const manifestJson = await carriedManifestJson(env, artifactId);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json, created_at, created_by, source, message, message_source)
         VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, 'editor', ?, ?)`
      ).bind(versionId, artifactId, newVersionNo, entrypoint, manifestJson, ctx.userId, message, message ? 'author' : null),
      env.DB.prepare(
        `INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(assetId, versionId, file, r2Key, mime, bytes.length, hash),
      // Every other file of the live version (images, other sheets, the original) carries
      // over unchanged — same R2 objects, which only an artifact purge ever deletes.
      env.DB.prepare(
        `INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
         SELECT 'ast_' || lower(hex(randomblob(12))), ?, path, r2_key, mime, size_bytes, sha256
           FROM assets WHERE version_id = ? AND path != ?`
      ).bind(versionId, current.versionId ?? '', file),
      env.DB.prepare(
        `INSERT INTO deployments (id, artifact_id, version_id, channel, slug, updated_at)
         VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(artifact_id, channel) DO UPDATE SET
           version_id = excluded.version_id,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
      ).bind(deploymentId, artifactId, versionId, channel, artifact.slug),
      env.DB.prepare(
        `UPDATE artifacts SET type_metadata = ? WHERE id = ?`
      ).bind(typeMetadata, artifactId),
      env.DB.prepare(
        `DELETE FROM artifact_drafts WHERE artifact_id = ? AND user_id = ?`
      ).bind(artifactId, ctx.userId),
    ]);

    // A candidate stage leaves the live production pointer (and its cache) untouched.
    if (!blocking) {
      await invalidateDeploymentCache(env, artifact.slug, artifactId);
    }

    const testRun = runPostPublishTests(
      env, artifactId, artifact.workspace_id ?? '', versionId, artifact.slug, blocking,
    ).catch(() => {});
    if (ctx.waitUntil) ctx.waitUntil(testRun); else await testRun;
    scheduleVersionSummary(env, ctx.waitUntil, versionId, message);

    return new Response(JSON.stringify({
      success: true,
      versionNo: newVersionNo,
      url: `${env.SHAREOUT_BASE_URL.replace(/\/$/, '')}/a/${artifact.slug}/`,
      ...(blocking ? { tests: { mode: 'block', pending: true } } : {}),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[SourceEditor] publish failed', { artifactId, error });
    return errorResponse('INTERNAL_ERROR', 'Failed to publish', 500);
  }
}

function errorResponse(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: message, code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
