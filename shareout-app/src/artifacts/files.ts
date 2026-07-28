/**
 * Read published artifact source files from R2 for a specific version.
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { requireRole } from './roles';
import { json } from './json-response';
import type { ArtifactFile, ArtifactFilesResponse } from './types';

const TEXT_MIME_TYPES = [
  'text/',
  'application/json',
  'application/javascript',
  'application/typescript',
  'application/xml',
  'application/xhtml+xml',
  'application/ld+json',
  'image/svg+xml',
];

function isTextMime(mime: string): boolean {
  return TEXT_MIME_TYPES.some(t => mime.startsWith(t) || mime === t);
}

export async function handleGetArtifactFiles(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const url = new URL(request.url);
  const versionParam = url.searchParams.get('version');

  const artifact = await env.DB.prepare(
    'SELECT id, owner_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ id: string; owner_id: string | null }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  const forbidden = await requireRole(env, artifactId, user.id, 'viewer');
  if (forbidden) return forbidden;

  let version: { id: string; version_no: number; entrypoint: string } | null = null;

  if (versionParam) {
    const versionNo = parseInt(versionParam, 10);
    if (!isNaN(versionNo)) {
      version = await env.DB.prepare(
        'SELECT id, version_no, entrypoint FROM versions WHERE artifact_id = ? AND version_no = ?'
      ).bind(artifactId, versionNo).first();
    } else {
      version = await env.DB.prepare(
        'SELECT id, version_no, entrypoint FROM versions WHERE id = ? AND artifact_id = ?'
      ).bind(versionParam, artifactId).first();
    }
  } else {
    const deployment = await env.DB.prepare(
      'SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = ?'
    ).bind(artifactId, 'production').first<{ version_id: string }>();

    if (deployment) {
      version = await env.DB.prepare(
        'SELECT id, version_no, entrypoint FROM versions WHERE id = ?'
      ).bind(deployment.version_id).first();
    }
  }

  if (!version) {
    return json({ error: 'Version not found', code: 'VERSION_NOT_FOUND' }, 404);
  }

  const assets = await env.DB.prepare(
    'SELECT path, r2_key, mime, size_bytes FROM assets WHERE version_id = ?'
  ).bind(version.id).all<{ path: string; r2_key: string; mime: string; size_bytes: number }>();

  const files: ArtifactFile[] = [];

  for (const asset of assets.results || []) {
    const obj = await env.ARTIFACTS.get(asset.r2_key);
    if (!obj) continue;

    let content: string;
    let encoding: 'utf8' | 'base64';

    if (isTextMime(asset.mime)) {
      content = await obj.text();
      encoding = 'utf8';
    } else {
      const buffer = await obj.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      content = btoa(binary);
      encoding = 'base64';
    }

    files.push({
      path: asset.path,
      content,
      encoding,
      mime: asset.mime,
      size_bytes: asset.size_bytes,
    });
  }

  const response: ArtifactFilesResponse = {
    artifact_id: artifactId,
    version_id: version.id,
    version_no: version.version_no,
    entrypoint: version.entrypoint,
    files,
  };

  return json(response);
}
