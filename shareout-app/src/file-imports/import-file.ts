/**
 * One import batch: fetch the files this run saw whose content changed since they were
 * last imported, store each as a workspace file through the normal blob path (same
 * validation, bucket limits and workspace storage quota), optionally turn documents into
 * live pages, and feed Knowledge. The storage quota stops the run cleanly; anything
 * else wrong with one file is recorded on that file and the run moves on.
 */
import type { Env } from '../types';
import { getOrCreateAssetBucket } from '../assets/bucket';
import { addDeliverableVersion, createDeliverable, setDeliverableFields } from '../assets/deliverables';
import { ingestBlobDirect } from '../data/blobs/handler';
import { checkStorageQuota, storageMaxFileBytes } from '../storage-quota';
import { queueKnowledgeSource } from '../knowledge/corpus/ingest';
import { BUFFER_MAX_BYTES, FILES_PER_STEP, MAX_CONVERSIONS_PER_RUN, type RemoteEntry } from './types';
import { stopRun } from './runs';
import { withToken, type Active } from './context';
import { fileVisibility, filenameProblem, pageVisibility, storableFilename, targetAudience, type Audience } from './mirror';
import { convertToPage, isConvertible } from './convert';
import { AuthExpiredError, RateLimitedError } from './http';
import { isGoogleNative } from './export-map';

interface FileItem {
  remote_id: string;
  name: string;
  path: string;
  remote_mime: string | null;
  remote_size: number | null;
  remote_version: string | null;
  synced_version: string | null;
  deliverable_id: string | null;
  artifact_id: string | null;
  artifact_slug: string | null;
  parent_folder_id: string | null;
}

type Outcome =
  | { kind: 'imported'; deliverableId: string; artifact?: { id: string; slug: string }; warning?: { code: string; message: string } }
  | { kind: 'unchanged' }
  | { kind: 'skipped' | 'failed'; code: string; message: string }
  | { kind: 'stop'; code: string; message: string };

const QUOTA_MESSAGE = 'Storage is full for this workspace. Free space (or raise the limit) and sync again; finished files are kept.';

class TooLarge extends Error {}

/** Read a stream whose size we do not know, refusing past `cap` bytes. */
async function readCapped(body: ReadableStream<Uint8Array>, cap: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { await reader.cancel().catch(() => {}); throw new TooLarge(); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

async function liveDeliverable(env: Env, bucketId: string, id: string | null): Promise<string | null> {
  if (!id) return null;
  const row = await env.DB.prepare('SELECT id FROM asset_deliverables WHERE id = ? AND bucket_artifact_id = ? AND deleted_at IS NULL')
    .bind(id, bucketId).first();
  return row ? id : null;
}

async function liveArtifactSlug(env: Env, workspaceId: string, id: string | null, slug: string | null): Promise<string | null> {
  if (!id || !slug) return null;
  const row = await env.DB.prepare('SELECT id FROM artifacts WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').bind(id, workspaceId).first();
  return row ? slug : null;
}

interface BatchCtx {
  a: Active;
  bucketId: string;
  audience: Audience;
  owner: { id: string; email: string | null };
  conversionsLeft: number;
}

async function importOne(c: BatchCtx, item: FileItem): Promise<Outcome> {
  const { a, bucketId } = c;
  const { env, source } = a;
  const folderId = item.parent_folder_id;
  const existing = await liveDeliverable(env, bucketId, item.deliverable_id);

  if (existing && item.synced_version && item.synced_version === item.remote_version) {
    // Unchanged content; follow a move between folders without refetching.
    await setDeliverableFields(env, bucketId, existing, { folderId });
    return { kind: 'unchanged' };
  }

  // A plain file keeps its name, so a blocked type is known before downloading it.
  if (!isGoogleNative(item.remote_mime ?? undefined)) {
    const early = filenameProblem(storableFilename(item.name));
    if (early) return { kind: 'skipped', ...early };
  }

  const fileMax = storageMaxFileBytes(env);
  if (fileMax > 0 && item.remote_size !== null && item.remote_size > fileMax) {
    return { kind: 'skipped', code: 'FILE_TOO_LARGE', message: `Larger than this instance's ${Math.round(fileMax / 1_000_000)} MB per-file limit.` };
  }
  if (item.remote_size !== null) {
    const q = await checkStorageQuota(env, bucketId, item.remote_size);
    if (!q.allowed && q.reason === 'over_quota') return { kind: 'stop', code: 'STORAGE_QUOTA_EXCEEDED', message: QUOTA_MESSAGE };
  }

  const entry: RemoteEntry = {
    id: item.remote_id, name: item.name, kind: 'file',
    mime: item.remote_mime ?? undefined, size: item.remote_size ?? undefined, version: item.remote_version ?? undefined,
  };
  const dl = await withToken(a, (t) => a.api.download(t, source.remote_drive_id, entry));
  if (!dl.ok) {
    return { kind: dl.code === 'NOT_EXPORTABLE' ? 'skipped' : 'failed', code: dl.code, message: dl.message };
  }

  const filename = storableFilename(dl.filename);
  const problem = filenameProblem(filename);
  if (problem) { await dl.body.cancel().catch(() => {}); return { kind: 'skipped', ...problem }; }

  let bytes: Uint8Array | null = null;
  try {
    if (dl.size === null || dl.size <= BUFFER_MAX_BYTES) bytes = await readCapped(dl.body, BUFFER_MAX_BYTES);
  } catch (e) {
    if (e instanceof TooLarge) return { kind: 'failed', code: 'FILE_TOO_LARGE', message: 'This export has no declared size and is over 25 MB.' };
    throw e;
  }
  const stored = await ingestBlobDirect(env, bucketId, bytes
    ? { filename, mimeType: dl.mime, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }
    : { filename, mimeType: dl.mime, stream: dl.body, size: dl.size! });
  if (!stored.ok || !stored.blobId) {
    if (stored.code === 'STORAGE_QUOTA_EXCEEDED' || stored.code === 'BUCKET_FULL') return { kind: 'stop', code: 'STORAGE_QUOTA_EXCEEDED', message: QUOTA_MESSAGE };
    if (stored.code === 'FILE_TOO_LARGE') return { kind: 'skipped', code: 'FILE_TOO_LARGE', message: stored.error || 'File too large.' };
    return { kind: 'failed', code: stored.code || 'STORE_FAILED', message: stored.error || 'Could not store the file.' };
  }

  let deliverableId = existing;
  if (deliverableId) {
    await addDeliverableVersion(env, bucketId, deliverableId, stored.blobId);
    await setDeliverableFields(env, bucketId, deliverableId, { folderId });
  } else {
    deliverableId = (await createDeliverable(env, bucketId, source.workspace_id, c.owner.id, item.name.slice(0, 200), stored.blobId,
      { folderId, visibility: fileVisibility(c.audience) })).id;
  }
  const outcome: Outcome = { kind: 'imported', deliverableId };
  if (bytes && isConvertible(env, filename, bytes.byteLength)) {
    if (c.conversionsLeft <= 0) {
      outcome.warning = { code: 'CONVERT_LIMIT', message: `Kept as a file: one import turns at most ${MAX_CONVERSIONS_PER_RUN} documents into pages.` };
    } else {
      c.conversionsLeft--;
      const page = await convertToPage(env, {
        user: c.owner, workspaceId: source.workspace_id, folderId, visibility: pageVisibility(c.audience),
        filename, displayName: item.name, bytes,
        slug: await liveArtifactSlug(env, source.workspace_id, item.artifact_id, item.artifact_slug),
      });
      if (page.ok) outcome.artifact = { id: page.artifactId, slug: page.slug };
      else if (page.code !== 'NOT_CONVERTIBLE') outcome.warning = { code: page.code, message: `Imported as a file; the page was not created: ${page.message}` };
    }
  }
  // The page is learned when it publishes; only a file that has no page is learned as a file.
  if (!outcome.artifact) await queueKnowledgeSource(env, undefined, { workspaceId: source.workspace_id, kind: 'asset', refId: deliverableId }, stored.blobId).catch(() => false);
  return outcome;
}

function record(env: Env, sourceId: string, runId: string, item: FileItem, o: Exclude<Outcome, { kind: 'stop' }>): D1PreparedStatement[] {
  const now = new Date().toISOString();
  const itemSql = env.DB.prepare(`
    UPDATE file_import_items SET attempt_run_id = ?, status = ?, synced_version = ?, deliverable_id = ?, artifact_id = ?, artifact_slug = ?,
      error_code = ?, error_message = ?, updated_at = ?
    WHERE source_id = ? AND remote_id = ?
  `);
  const runSql = (col: string, extra = '') => env.DB.prepare(`UPDATE file_import_runs SET ${col} = ${col} + 1${extra}, updated_at = ? WHERE id = ?`).bind(now, runId);
  if (o.kind === 'unchanged') {
    return [
      itemSql.bind(runId, 'imported', item.synced_version, item.deliverable_id, item.artifact_id, item.artifact_slug, null, null, now, sourceId, item.remote_id),
      runSql('unchanged_count'),
    ];
  }
  if (o.kind === 'imported') {
    return [
      itemSql.bind(runId, 'imported', item.remote_version, o.deliverableId, o.artifact?.id ?? item.artifact_id, o.artifact?.slug ?? item.artifact_slug,
        o.warning?.code ?? null, o.warning?.message ?? null, now, sourceId, item.remote_id),
      runSql('imported_count', o.artifact ? ', converted_count = converted_count + 1' : ''),
    ];
  }
  return [
    itemSql.bind(runId, o.kind, item.synced_version, item.deliverable_id, item.artifact_id, item.artifact_slug, o.code, o.message.slice(0, 500), now, sourceId, item.remote_id),
    runSql(o.kind === 'skipped' ? 'skipped_count' : 'failed_count'),
  ];
}

export async function importBatch(a: Active): Promise<{ done: boolean }> {
  const { env, source, run } = a;
  const items = (await env.DB.prepare(`
    SELECT i.remote_id, i.name, i.path, i.remote_mime, i.remote_size, i.remote_version, i.synced_version,
           i.deliverable_id, i.artifact_id, i.artifact_slug, p.folder_id AS parent_folder_id
    FROM file_import_items i
    LEFT JOIN file_import_items p ON p.source_id = i.source_id AND p.remote_id = i.parent_remote_id
    WHERE i.source_id = ? AND i.seen_run_id = ? AND i.kind = 'file' AND IFNULL(i.attempt_run_id, '') != ?
    ORDER BY i.path LIMIT ?
  `).bind(source.id, run.id, run.id, FILES_PER_STEP).all<FileItem>()).results || [];
  if (!items.length) return { done: true };

  const bucket = await getOrCreateAssetBucket(env, a.conn.user_id, source.workspace_id);
  const owner = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(a.conn.user_id).first<{ id: string; email: string | null }>();
  const ctx: BatchCtx = {
    a, bucketId: bucket.id,
    audience: await targetAudience(env, source.workspace_id, source.target_folder_id),
    owner: owner ?? { id: a.conn.user_id, email: null },
    conversionsLeft: MAX_CONVERSIONS_PER_RUN - run.converted_count,
  };

  for (const item of items) {
    let o: Outcome;
    try {
      o = await importOne(ctx, item);
    } catch (e) {
      // Throttling and revoked consent are about the run, not this file.
      if (e instanceof RateLimitedError || e instanceof AuthExpiredError) throw e;
      o = { kind: 'failed', code: 'IMPORT_FAILED', message: e instanceof Error ? e.message : 'Unexpected error' };
    }
    if (o.kind === 'stop') {
      await stopRun(env, run.id, 'stopped', o.code, o.message);
      return { done: true };
    }
    await env.DB.batch(record(env, source.id, run.id, item, o));
  }
  return { done: false };
}
