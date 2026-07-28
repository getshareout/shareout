/**
 * R2 asset storage for published versions — writes blobs, records D1 asset rows,
 * and returns metadata for the enhanced manifest.
 */
import type { Env, FileEntry } from '../types';
import { sha256, generateId } from '../crypto-utils';
import { determinePriority } from './manifest';
import type { AssetMetadata } from './types';

export function getCacheControl(mime: string): string {
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime.startsWith('font/')) {
    return 'public, max-age=31536000, immutable';
  }
  if (mime === 'text/html') {
    return 'public, max-age=0, must-revalidate';
  }
  return 'public, max-age=86400';
}

export async function storeAsset(
  env: Env,
  versionId: string,
  artifactId: string,
  versionNo: number,
  file: FileEntry,
): Promise<AssetMetadata> {
  const content = file.encoding === 'base64'
    ? Uint8Array.from(atob(file.content), c => c.charCodeAt(0))
    : new TextEncoder().encode(file.content);

  const hash = await sha256(content.buffer as ArrayBuffer);
  const r2Key = `${artifactId}/v${versionNo}/${file.path}`;
  const cacheControl = getCacheControl(file.mime);
  const priority = determinePriority(file.path, file.mime, content.length);
  const inlineable = content.length < 4096;

  await env.ARTIFACTS.put(r2Key, content, {
    httpMetadata: { contentType: file.mime, cacheControl },
    customMetadata: { sha256: hash, originalPath: file.path },
  });

  const assetId = generateId('ast');
  await env.DB.prepare(`
    INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(assetId, versionId, file.path, r2Key, file.mime, content.length, hash).run();

  return { path: file.path, mime: file.mime, size: content.length, priority, inlineable };
}

/** Store all publish files plus optional mobile HTML; returns manifest asset list. */
export async function storeVersionAssets(
  env: Env,
  versionId: string,
  artifactId: string,
  versionNo: number,
  files: FileEntry[],
  mobileHtml?: string,
  mobileEntrypoint?: string | null,
): Promise<AssetMetadata[]> {
  const assetMetadata = await Promise.all(
    files.map(f => storeAsset(env, versionId, artifactId, versionNo, f)),
  );

  if (mobileHtml && mobileEntrypoint) {
    const mobileAsset = await storeAsset(env, versionId, artifactId, versionNo, {
      path: mobileEntrypoint,
      content: mobileHtml,
      mime: 'text/html',
    });
    assetMetadata.push(mobileAsset);
  }

  return assetMetadata;
}
