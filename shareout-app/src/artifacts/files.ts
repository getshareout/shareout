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

export function isTextMime(mime: string): boolean {
  return TEXT_MIME_TYPES.some(t => mime.startsWith(t) || mime === t);
}

/** UTF-8 text of stored bytes, byte-order mark kept, so writing it back changes nothing. */
export function decodeText(bytes: Uint8Array, fatal = false): string {
  return new TextDecoder('utf-8', { ignoreBOM: true, fatal }).decode(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * `?paths=a,b` (or repeated `paths=`): the requested subset, null when none was asked.
 * A value that is itself a file's path wins over splitting it, so paths with commas work.
 */
function selectPaths(values: string[], known: string[]): { paths: Set<string> | null; missing: string[] } {
  if (!values.length) return { paths: null, missing: [] };
  const all = new Set(known);
  const wanted = values.flatMap((v) => (all.has(v) ? [v] : v.split(',').map((p) => p.trim()).filter(Boolean)));
  return { paths: new Set(wanted), missing: [...new Set(wanted.filter((p) => !all.has(p)))] };
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

  const { results: assets } = await env.DB.prepare(
    'SELECT path, r2_key, mime, size_bytes, sha256 FROM assets WHERE version_id = ? ORDER BY path'
  ).bind(version.id).all<{ path: string; r2_key: string; mime: string; size_bytes: number; sha256: string }>();

  const picked = selectPaths(url.searchParams.getAll('paths'), (assets ?? []).map((a) => a.path));
  if (picked.missing.length) {
    return json({
      success: false,
      error: `No file ${picked.missing.map((p) => JSON.stringify(p)).join(', ')} in version ${version.version_no}`,
      code: 'FILE_NOT_FOUND',
      missing: picked.missing,
      hint: 'List the files with ?manifest=1.',
    }, 404);
  }
  const selected = (assets ?? []).filter((a) => !picked.paths || picked.paths.has(a.path));

  if (url.searchParams.get('manifest') === '1') {
    return json({
      artifact_id: artifactId,
      version_id: version.id,
      version_no: version.version_no,
      entrypoint: version.entrypoint,
      files: selected.map((a) => ({ path: a.path, mime: a.mime, size: a.size_bytes, sha256: a.sha256 })),
    });
  }

  const read = await Promise.all(selected.map(async (asset): Promise<ArtifactFile | null> => {
    const obj = await env.ARTIFACTS.get(asset.r2_key);
    if (!obj) return null;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const text = isTextMime(asset.mime);
    return {
      path: asset.path,
      content: text ? decodeText(bytes) : toBase64(bytes),
      encoding: text ? 'utf8' : 'base64',
      mime: asset.mime,
      size_bytes: asset.size_bytes,
    };
  }));
  const files = read.filter((f): f is ArtifactFile => f !== null);
  const unreadable = selected.filter((_, i) => !read[i]).map((a) => a.path);

  const response: ArtifactFilesResponse = {
    artifact_id: artifactId,
    version_id: version.id,
    version_no: version.version_no,
    entrypoint: version.entrypoint,
    files,
    ...(unreadable.length ? { unreadable } : {}),
  };

  return json(response);
}
