import type { Env } from '../types';
import { getPlatformOrigin } from '../config/origins';
import { sha256 } from '../crypto-utils';

const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;

export interface MediaItem {
  path: string;
  srcKey: string;
  mime: string;
  size: number;
}

const extOf = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
};

/** Rewrites this artifact's blob content URLs in `content` to relative `media/<blobId>.<ext>`
 *  paths (relative to `file`) so a published version carries its own copy of the bytes. */
export async function planMedia(
  env: Env,
  artifactId: string,
  file: string,
  content: string,
): Promise<{ content: string; items: MediaItem[]; bytes: number }> {
  const origin = getPlatformOrigin(env).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:${origin})?/v1/data/${artifactId}/blobs/([\\w-]+)/content`, 'g');
  const ids = [...new Set([...content.matchAll(re)].map((m) => m[1]))];
  if (!ids.length) return { content, items: [], bytes: 0 };

  const { results } = await env.DB.prepare(
    `SELECT id, filename, mime_type, r2_key, size_bytes FROM blobs
      WHERE artifact_id = ? AND id IN (${ids.map(() => '?').join(',')})`
  ).bind(artifactId, ...ids).all<{ id: string; filename: string; mime_type: string; r2_key: string; size_bytes: number }>();

  const up = '../'.repeat(file.split('/').length - 1);
  const rel = new Map<string, string>();
  const items: MediaItem[] = [];
  let bytes = 0;
  for (const b of results ?? []) {
    if (bytes + b.size_bytes > MAX_BUNDLE_BYTES) continue;
    bytes += b.size_bytes;
    const path = `media/${b.id}.${extOf(b.filename)}`;
    rel.set(b.id, up + path);
    items.push({ path, srcKey: b.r2_key, mime: b.mime_type, size: b.size_bytes });
  }
  return { content: content.replace(re, (all, id) => rel.get(id) ?? all), items, bytes };
}

/** Copies the planned media into the new version's R2 prefix; returns its `assets` insert statements. */
export async function writeMedia(env: Env, artifactId: string, versionId: string, items: MediaItem[]) {
  const stmts: D1PreparedStatement[] = [];
  for (const m of items) {
    const obj = await env.ARTIFACTS.get(m.srcKey);
    if (!obj) throw new Error(`media source missing: ${m.srcKey}`);
    const body = await obj.arrayBuffer();
    const hash = await sha256(body);
    const r2Key = `${artifactId}/${versionId}/${m.path}`;
    await env.ARTIFACTS.put(r2Key, body, { httpMetadata: { contentType: m.mime }, customMetadata: { sha256: hash } });
    stmts.push(env.DB.prepare(
      `INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
       VALUES ('ast_' || lower(hex(randomblob(12))), ?, ?, ?, ?, ?, ?)`
    ).bind(versionId, m.path, r2Key, m.mime, body.byteLength, hash));
  }
  return stmts;
}

/** Statement carrying the live version's earlier media forward, minus paths just re-bundled. */
export function carryMedia(env: Env, versionId: string, artifactId: string, items: MediaItem[]) {
  const skip = items.length ? items.map(() => '?').join(',') : "''";
  return env.DB.prepare(
    `INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
     SELECT 'ast_' || lower(hex(randomblob(12))), ?, path, r2_key, mime, size_bytes, sha256
       FROM assets WHERE path LIKE 'media/%' AND path NOT IN (${skip})
        AND version_id = (SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'production')`
  ).bind(versionId, ...items.map((m) => m.path), artifactId);
}
