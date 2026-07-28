/**
 * Asset Deliverables (work 029): versioned named files, shareable collections,
 * and unguessable public download links. All scoped to a bucket (see bucket.ts).
 */
import type { Env } from '../types';
import { generateId, sha256 } from '../crypto-utils';
import { getPlatformOrigin } from '../config/origins';

export type LinkGate = 'none' | 'password' | 'domain';

/** Hash a delivery-link password (salted, distinct from slides links). */
export async function hashAssetLinkPassword(pw: string): Promise<string> {
  return sha256(new TextEncoder().encode(`asset-link:${pw}`).buffer as ArrayBuffer);
}

export interface FileEnrichment {
  status: 'ok' | 'unsupported' | 'failed';
  summary?: string;
  tags?: string[];
  blobId: string;
  model?: string;
  at: string;
}

export interface DeliverableRow {
  id: string;
  name: string;
  ownerId: string;
  visibility: string;
  folderId: string | null;
  versionCount: number;
  latestVersion: number;
  blobId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  updatedAt: string;
  // AI enrichment (work/042 P4); null until enriched, or fresh only when it matches blobId.
  enrichment: FileEnrichment | null;
  // How many artifacts reference this file (usage graph, work/042 P4).
  usageCount: number;
}

/** Create a named deliverable in a bucket and link an existing blob as v1. */
export async function createDeliverable(
  env: Env,
  bucketId: string,
  workspaceId: string | null,
  ownerId: string,
  name: string,
  blobId: string,
  opts: { folderId?: string | null; visibility?: string } = {},
): Promise<{ id: string }> {
  const id = generateId('dlv');
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, folder_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, bucketId, workspaceId, ownerId, name, opts.folderId ?? null, opts.visibility || 'workspace'),
    env.DB.prepare('UPDATE blobs SET deliverable_id = ?, version_no = 1 WHERE id = ? AND artifact_id = ?')
      .bind(id, blobId, bucketId),
  ]);
  return { id };
}

/** Update a file's own properties (visibility, folder). Scoped to the bucket. */
export async function setDeliverableFields(
  env: Env,
  bucketId: string,
  id: string,
  fields: { visibility?: string; folderId?: string | null },
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.visibility !== undefined) { sets.push('visibility = ?'); vals.push(fields.visibility); }
  if (fields.folderId !== undefined) { sets.push('folder_id = ?'); vals.push(fields.folderId); }
  if (!sets.length) return false;
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  const res = await env.DB.prepare(
    `UPDATE asset_deliverables SET ${sets.join(', ')} WHERE id = ? AND bucket_artifact_id = ? AND deleted_at IS NULL`,
  ).bind(...vals, id, bucketId).run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Attach a freshly-uploaded blob to a deliverable as its next version. */
export async function addDeliverableVersion(env: Env, bucketId: string, deliverableId: string, blobId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(MAX(version_no), 0) AS n FROM blobs WHERE deliverable_id = ?',
  ).bind(deliverableId).first<{ n: number }>();
  const next = (row?.n ?? 0) + 1;
  await env.DB.batch([
    env.DB.prepare('UPDATE blobs SET deliverable_id = ?, version_no = ? WHERE id = ? AND artifact_id = ?')
      .bind(deliverableId, next, blobId, bucketId),
    env.DB.prepare("UPDATE asset_deliverables SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(deliverableId),
  ]);
  return next;
}

/** Enrichment from a deliverable's type_metadata, but ONLY if it describes the current
 *  blob (a stale summary from an older version is hidden, not served). */
function freshEnrichment(typeMetadata: string | null, latestBlobId: string): FileEnrichment | null {
  if (!typeMetadata) return null;
  try {
    const e = (JSON.parse(typeMetadata) as { enrichment?: FileEnrichment }).enrichment;
    return e && e.blobId === latestBlobId ? e : null;
  } catch { return null; }
}

/** Latest version of every live deliverable in a bucket, newest first.
 *  Pass folderId to scope to one folder (null-string '' = bucket root). */
export async function listDeliverables(env: Env, bucketId: string): Promise<DeliverableRow[]> {
  const rows = await env.DB.prepare(`
    SELECT d.id, d.name, d.owner_id, d.visibility, d.folder_id, d.updated_at, d.type_metadata,
           (SELECT COUNT(*) FROM blobs WHERE deliverable_id = d.id) AS version_count,
           (SELECT COUNT(*) FROM file_artifact_usage WHERE deliverable_id = d.id) AS usage_count,
           b.id AS blob_id, b.filename, b.mime_type, b.size_bytes, b.version_no
    FROM asset_deliverables d
    JOIN blobs b ON b.deliverable_id = d.id
    WHERE d.bucket_artifact_id = ? AND d.deleted_at IS NULL
      AND b.version_no = (SELECT MAX(version_no) FROM blobs WHERE deliverable_id = d.id)
    ORDER BY d.updated_at DESC
  `).bind(bucketId).all<{
    id: string; name: string; owner_id: string; visibility: string; folder_id: string | null; updated_at: string;
    type_metadata: string | null;
    version_count: number; usage_count: number; blob_id: string; filename: string; mime_type: string; size_bytes: number; version_no: number;
  }>();
  return (rows.results || []).map((r) => ({
    id: r.id, name: r.name, ownerId: r.owner_id, visibility: r.visibility || 'workspace', folderId: r.folder_id,
    versionCount: r.version_count, latestVersion: r.version_no,
    blobId: r.blob_id, filename: r.filename, mimeType: r.mime_type, sizeBytes: r.size_bytes, updatedAt: r.updated_at,
    // Only surface enrichment that matches the current version (stale = hidden).
    enrichment: freshEnrichment(r.type_metadata, r.blob_id),
    usageCount: r.usage_count,
  }));
}

/** Every version of one deliverable, newest first. */
export async function listDeliverableVersions(env: Env, bucketId: string, deliverableId: string): Promise<Array<{ blobId: string; versionNo: number; filename: string; sizeBytes: number; createdAt: string }>> {
  const rows = await env.DB.prepare(`
    SELECT b.id AS blob_id, b.version_no, b.filename, b.size_bytes, b.created_at
    FROM blobs b JOIN asset_deliverables d ON d.id = b.deliverable_id
    WHERE b.deliverable_id = ? AND d.bucket_artifact_id = ?
    ORDER BY b.version_no DESC
  `).bind(deliverableId, bucketId).all<{ blob_id: string; version_no: number; filename: string; size_bytes: number; created_at: string }>();
  return (rows.results || []).map((r) => ({ blobId: r.blob_id, versionNo: r.version_no, filename: r.filename, sizeBytes: r.size_bytes, createdAt: r.created_at }));
}

// ---- Collections + share links ----

export async function createCollection(
  env: Env,
  bucketId: string,
  workspaceId: string | null,
  ownerId: string,
  name: string,
  deliverableIds: string[],
): Promise<{ id: string }> {
  const id = generateId('col');
  const stmts = [
    env.DB.prepare('INSERT INTO asset_collections (id, bucket_artifact_id, workspace_id, owner_id, name) VALUES (?, ?, ?, ?, ?)')
      .bind(id, bucketId, workspaceId, ownerId, name),
    ...deliverableIds.map((dId, i) =>
      env.DB.prepare('INSERT INTO asset_collection_items (collection_id, deliverable_id, position) VALUES (?, ?, ?)').bind(id, dId, i)),
  ];
  await env.DB.batch(stmts);
  return { id };
}

export async function createShareLink(
  env: Env,
  collectionId: string,
  createdBy: string,
  opts: { expiresAt?: string | null; gate?: LinkGate; gateValue?: string | null } = {},
): Promise<{ id: string; url: string }> {
  const id = generateId('dlk');
  const gate: LinkGate = opts.gate === 'password' || opts.gate === 'domain' ? opts.gate : 'none';
  await env.DB.prepare(
    'INSERT INTO asset_share_links (id, collection_id, expires_at, created_by, gate, gate_value) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(id, collectionId, opts.expiresAt ?? null, createdBy, gate, gate === 'none' ? null : (opts.gateValue ?? null)).run();
  const base = getPlatformOrigin(env);
  return { id, url: `${base}/d/${id}` };
}

export interface ResolvedShareLink {
  collectionName: string;
  bucketId: string;
  expiresAt: string | null;
  gate: LinkGate;
  gateValue: string | null;
  createdBy: string | null;
  viewCount: number;
  files: Array<{ blobId: string; deliverableName: string; filename: string; mimeType: string; sizeBytes: number; version: number; contentPath: string }>;
}

/** Public resolution for the download page. Returns null when missing/revoked/expired. */
export async function resolveShareLink(env: Env, token: string): Promise<ResolvedShareLink | null> {
  const link = await env.DB.prepare(
    'SELECT collection_id, expires_at, revoked, gate, gate_value, created_by, view_count FROM asset_share_links WHERE id = ?',
  ).bind(token).first<{ collection_id: string; expires_at: string | null; revoked: number; gate: string | null; gate_value: string | null; created_by: string | null; view_count: number }>();
  if (!link || link.revoked) return null;
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return null;

  const col = await env.DB.prepare(
    'SELECT name, bucket_artifact_id FROM asset_collections WHERE id = ?',
  ).bind(link.collection_id).first<{ name: string; bucket_artifact_id: string }>();
  if (!col) return null;

  const rows = await env.DB.prepare(`
    SELECT d.name AS deliverable_name, b.filename, b.mime_type, b.size_bytes, b.version_no, b.id AS blob_id
    FROM asset_collection_items ci
    JOIN asset_deliverables d ON d.id = ci.deliverable_id
    JOIN blobs b ON b.deliverable_id = d.id AND b.version_no = (SELECT MAX(version_no) FROM blobs WHERE deliverable_id = d.id)
    WHERE ci.collection_id = ?
    ORDER BY ci.position
  `).bind(link.collection_id).all<{ deliverable_name: string; filename: string; mime_type: string; size_bytes: number; version_no: number; blob_id: string }>();

  return {
    collectionName: col.name,
    bucketId: col.bucket_artifact_id,
    expiresAt: link.expires_at,
    gate: (link.gate === 'password' || link.gate === 'domain') ? link.gate : 'none',
    gateValue: link.gate_value,
    createdBy: link.created_by,
    viewCount: link.view_count,
    files: (rows.results || []).map((r) => ({
      blobId: r.blob_id,
      deliverableName: r.deliverable_name,
      filename: r.filename,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      version: r.version_no,
      contentPath: `/v1/data/${col.bucket_artifact_id}/blobs/${r.blob_id}/content`,
    })),
  };
}

export interface ShareLinkSummary {
  id: string;
  url: string;
  collectionId: string;
  collectionName: string;
  fileCount: number;
  gate: LinkGate;
  expiresAt: string | null;
  revoked: boolean;
  expired: boolean;
  viewCount: number;
  createdAt: string;
}

/** Every share link minted from this bucket's collections, newest first. */
export async function listShareLinks(env: Env, bucketId: string): Promise<ShareLinkSummary[]> {
  const base = getPlatformOrigin(env);
  const now = Date.now();
  const rows = await env.DB.prepare(`
    SELECT l.id, l.collection_id, l.gate, l.expires_at, l.revoked, l.view_count, l.created_at,
           c.name AS collection_name,
           (SELECT COUNT(*) FROM asset_collection_items ci WHERE ci.collection_id = c.id) AS file_count
    FROM asset_share_links l
    JOIN asset_collections c ON c.id = l.collection_id
    WHERE c.bucket_artifact_id = ?
    ORDER BY l.created_at DESC
  `).bind(bucketId).all<{ id: string; collection_id: string; gate: string | null; expires_at: string | null; revoked: number; view_count: number; created_at: string; collection_name: string; file_count: number }>();
  return (rows.results || []).map((r) => ({
    id: r.id,
    url: `${base}/d/${r.id}`,
    collectionId: r.collection_id,
    collectionName: r.collection_name,
    fileCount: r.file_count,
    gate: (r.gate === 'password' || r.gate === 'domain') ? r.gate : 'none',
    expiresAt: r.expires_at,
    revoked: r.revoked === 1,
    expired: !!r.expires_at && new Date(r.expires_at).getTime() < now,
    viewCount: r.view_count,
    createdAt: r.created_at,
  }));
}

/** Revoke a link — scoped to the bucket so a member can't revoke another scope's. */
export async function revokeShareLink(env: Env, bucketId: string, linkId: string): Promise<boolean> {
  const res = await env.DB.prepare(`
    UPDATE asset_share_links SET revoked = 1
    WHERE id = ? AND collection_id IN (SELECT id FROM asset_collections WHERE bucket_artifact_id = ?)
  `).bind(linkId, bucketId).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function bumpShareLinkViews(env: Env, token: string): Promise<void> {
  await env.DB.prepare('UPDATE asset_share_links SET view_count = view_count + 1 WHERE id = ?').bind(token).run().catch(() => {});
}
