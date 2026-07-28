// ShareOut Source Editor — request handlers for non-HTML artifact editing.

import type { Env, ArtifactType } from '../../types';
import type { EditorContext } from '../index';
import { generateId, sha256 } from '../../crypto-utils';
import { invalidateDeploymentCache } from '../../serve/deployment-cache';
import { generateTypeMetadata } from '../../validation';
import { generateSourceEditorPage, type SourceEditableType } from './page';
import { shouldBlockPublish, runPostPublishTests } from '../../tests/block-gate';

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
  mime: string;
  content: string;
  versionNo: number;
}

async function loadCurrentSource(
  env: Env,
  artifactId: string,
  type: SourceEditableType
): Promise<CurrentSource> {
  const row = await env.DB.prepare(`
    SELECT v.entrypoint, v.version_no
    FROM deployments d
    JOIN versions v ON v.id = d.version_id
    WHERE d.artifact_id = ? AND d.channel = 'production'
  `).bind(artifactId).first<{ entrypoint: string | null; version_no: number | null }>();

  const entrypoint = row?.entrypoint || `index.${type === 'markdown' ? 'md' : type}`;
  let mime = DEFAULT_MIME[type];
  let content = '';

  if (row?.entrypoint) {
    const asset = await env.DB.prepare(`
      SELECT a.r2_key, a.mime
      FROM deployments d
      JOIN versions v ON v.id = d.version_id
      JOIN assets a ON a.version_id = v.id AND a.path = v.entrypoint
      WHERE d.artifact_id = ? AND d.channel = 'production'
    `).bind(artifactId).first<{ r2_key: string; mime: string }>();
    if (asset) {
      if (asset.mime) mime = asset.mime;
      const obj = await env.ARTIFACTS.get(asset.r2_key);
      if (obj) content = await obj.text();
    }
  }

  return { entrypoint, mime, content, versionNo: row?.version_no || 0 };
}

export async function serveSourceEditorPage(
  env: Env,
  artifact: { id: string; slug: string; name: string | null; artifact_type: ArtifactType },
  type: SourceEditableType,
  baseUrl: string
): Promise<Response> {
  const current = await loadCurrentSource(env, artifact.id, type);

  const html = generateSourceEditorPage({
    artifactId: artifact.id,
    slug: artifact.slug,
    name: artifact.name || artifact.slug,
    type,
    entrypoint: current.entrypoint,
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
    const body = await request.json() as { content?: string };
    if (typeof body.content !== 'string') {
      return errorResponse('INVALID_REQUEST', 'content required', 400);
    }

    const artifact = await env.DB.prepare(
      `SELECT id, name, slug, workspace_id, artifact_type FROM artifacts WHERE id = ?`
    ).bind(artifactId).first<{ id: string; name: string; slug: string; workspace_id: string | null; artifact_type: ArtifactType }>();

    if (!artifact) {
      return errorResponse('ARTIFACT_NOT_FOUND', 'Artifact not found', 404);
    }
    if (!isSourceEditable(artifact.artifact_type)) {
      return errorResponse('UNSUPPORTED', 'This artifact type is not source-editable', 400);
    }

    // Artifact Tests BLOCK gate (see specs §3, §11): stage as a candidate when tests
    // block and a passing baseline exists; otherwise publish live. Never goes dark.
    const blocking = await shouldBlockPublish(env, artifactId);
    const channel = blocking ? 'candidate' : 'production';

    const type = artifact.artifact_type;
    const current = await loadCurrentSource(env, artifactId, type);
    const entrypoint = current.entrypoint;
    const mime = current.mime;

    const currentVersion = await env.DB.prepare(
      `SELECT MAX(version_no) as max_version FROM versions WHERE artifact_id = ?`
    ).bind(artifactId).first<{ max_version: number | null }>();
    const newVersionNo = (currentVersion?.max_version || 0) + 1;

    const versionId = generateId('ver');
    const assetId = generateId('ast');
    const deploymentId = generateId('dep');

    const bytes = new TextEncoder().encode(body.content);
    const hash = await sha256(bytes.buffer as ArrayBuffer);
    const r2Key = `${artifactId}/${versionId}/${entrypoint}`;
    await env.ARTIFACTS.put(r2Key, body.content, {
      httpMetadata: { contentType: mime },
      customMetadata: { sha256: hash },
    });

    const typeMetadata = JSON.stringify(generateTypeMetadata(type, body.content, mime));

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json, created_at)
         VALUES (?, ?, ?, ?, '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      ).bind(versionId, artifactId, newVersionNo, entrypoint),
      env.DB.prepare(
        `INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(assetId, versionId, entrypoint, r2Key, mime, bytes.length, hash),
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
