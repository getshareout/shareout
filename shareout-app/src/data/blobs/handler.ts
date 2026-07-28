import { DATA_ERRORS, type Env } from '../../types';
import { generateId } from '../../crypto-utils';
import {
  successResponse,
  errorResponse,
  corsHeaders,
  type DataContext,
} from '../middleware';
import { Errors } from '../errors';
import { presignGet, presignPut } from '../r2-presign';
import { serveCachedR2Bytes } from '../r2-cache';
import { checkStorageQuota, storageQuotaError } from '../../storage-quota';

export const MAX_FILE_SIZE = 50_000_000; // 50MB per file
export const MAX_ARTIFACT_STORAGE = 500_000_000; // 500MB per artifact
const MAX_BLOBS_PER_ARTIFACT = 1000;
// Asset buckets are a library, not a page's attachments — lift the caps.
const BUCKET_FILE_SIZE = 500_000_000; // 500MB per file
const BUCKET_STORAGE = 10_000_000_000; // 10GB per bucket
const BUCKET_BLOBS = 10_000;
const FILENAME_PATTERN = /^[a-zA-Z0-9_\-\.\s\(\)\[\]]+$/;
const MAX_FILENAME_LENGTH = 255;

const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const ALLOWED_MIME_TYPES = [
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/pdf',
  'application/json',
  // Office + open-document formats (xlsx/docx/pptx, legacy, ODF)
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  // Archives
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-tar',
];

// Executable/script types stay blocked everywhere (served-content XSS / RCE).
// Archives are allowed — they download, never execute, and serve as attachments.
const BLOCKED_EXTENSIONS = [
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.html', '.htm', '.xhtml',
  '.php', '.py', '.rb', '.sh', '.bash', '.zsh',
  '.exe', '.dll', '.so', '.dylib',
  '.bat', '.cmd', '.ps1',
];

/** Per-file / per-store / per-count caps — lifted for asset buckets. */
function blobLimits(ctx: DataContext): { maxFile: number; maxStorage: number; maxCount: number } {
  return ctx.assetBucket
    ? { maxFile: BUCKET_FILE_SIZE, maxStorage: BUCKET_STORAGE, maxCount: BUCKET_BLOBS }
    : { maxFile: MAX_FILE_SIZE, maxStorage: MAX_ARTIFACT_STORAGE, maxCount: MAX_BLOBS_PER_ARTIFACT };
}

/** Inline in the browser only for safe, displayable media; everything else
 *  downloads (attachment + nosniff) so a doc/archive can never be sniffed into
 *  active content on the serving domain. SVG is treated as non-inline (script). */
export function isInlineType(mime: string): boolean {
  if (mime === 'image/svg+xml') return false;
  return mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime === 'application/pdf';
}

interface BlobRow {
  id: string;
  artifact_id: string;
  filename: string;
  mime_type: string;
  r2_key: string;
  size_bytes: number;
  created_at: string;
}

interface UploadTokenRow {
  id: string;
  artifact_id: string;
  filename: string;
  mime_type: string;
  r2_key: string;
  max_size: number;
  expires_at: string;
  used_at: string | null;
}

interface StorageRow {
  artifact_id: string;
  used_bytes: number;
  blob_count: number;
}

export async function handleBlobs(
  request: Request,
  ctx: DataContext,
  path: string
): Promise<Response> {
  const parts = path.split('/').filter(Boolean);
  const [id, action] = parts;
  const method = request.method;

  if (!id && method === 'GET') {
    return listBlobs(request, ctx);
  }

  if (id === 'upload' && method === 'POST') {
    return requestUpload(request, ctx);
  }

  if (id === 'storage' && method === 'GET') {
    return getStorageUsage(ctx);
  }

  if (action === 'content' && method === 'GET') {
    return getBlobContent(ctx, id);
  }

  if (action === 'download-url' && method === 'GET') {
    return getBlobDownloadUrl(ctx, id);
  }

  if (action === 'confirm' && method === 'POST') {
    return confirmBlobUpload(ctx, id);
  }

  if (id && !action && method === 'GET') {
    return getBlobMetadata(ctx, id);
  }

  if (id && !action && method === 'DELETE') {
    return deleteBlob(ctx, id);
  }

  return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
}

export async function handleBlobUpload(
  request: Request,
  ctx: DataContext,
  tokenId: string
): Promise<Response> {
  if (request.method !== 'PUT') {
    return errorResponse(Errors.methodNotAllowed(request.method, ['PUT']), ctx.origin);
  }

  const token = await ctx.env.DB.prepare(`
    SELECT * FROM upload_tokens
    WHERE id = ? AND kind = 'blob' AND artifact_id = ? AND used_at IS NULL
  `).bind(tokenId, ctx.artifactId).first<UploadTokenRow>();

  if (!token) {
    return errorResponse({
      ...DATA_ERRORS.UPLOAD_TOKEN_INVALID,
      hint: `Token "${tokenId}" is invalid, expired, or already used.`,
    }, ctx.origin);
  }

  if (new Date(token.expires_at) < new Date()) {
    return errorResponse({
      ...DATA_ERRORS.UPLOAD_TOKEN_EXPIRED,
      hint: `Token expired at ${token.expires_at}. Tokens are valid for 15 minutes.`,
    }, ctx.origin);
  }

  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > token.max_size) {
    return errorResponse(
      Errors.formatSize('FILE_TOO_LARGE', 'File too large', token.max_size, contentLength),
      ctx.origin
    );
  }

  const storage = await getOrCreateStorage(ctx);
  const putMax = blobLimits(ctx).maxStorage;
  if (storage.used_bytes + contentLength > putMax) {
    return errorResponse({
      ...DATA_ERRORS.STORAGE_LIMIT_EXCEEDED,
      hint: `Current usage: ${(storage.used_bytes / 1_000_000).toFixed(2)}MB. Adding ${(contentLength / 1_000_000).toFixed(2)}MB would exceed ${putMax / 1_000_000}MB limit.`,
      suggestion: 'Delete unused blobs with DELETE /blobs/{id} to free up space.',
    }, ctx.origin);
  }

  // Early per-workspace cap on the declared size — fast-rejects an honest large
  // upload before buffering it. Absent/understated Content-Length slips past here
  // (0 passes); the authoritative re-check on actual bytes is below.
  const declaredQuota = await checkStorageQuota(ctx.env, ctx.artifactId, contentLength);
  if (!declaredQuota.allowed) {
    return errorResponse(storageQuotaError(declaredQuota), ctx.origin);
  }

  const body = await request.arrayBuffer();

  // Content-Length is client-supplied and absent under chunked encoding (parses
  // to 0, passing every cap above). Re-validate against the actual buffered size
  // before storing — this is the authoritative check.
  const actualSize = body.byteLength;
  if (actualSize > token.max_size) {
    return errorResponse(
      Errors.formatSize('FILE_TOO_LARGE', 'File too large', token.max_size, actualSize),
      ctx.origin
    );
  }
  if (storage.used_bytes + actualSize > putMax) {
    return errorResponse({
      ...DATA_ERRORS.STORAGE_LIMIT_EXCEEDED,
      hint: `Current usage: ${(storage.used_bytes / 1_000_000).toFixed(2)}MB. Adding ${(actualSize / 1_000_000).toFixed(2)}MB would exceed ${putMax / 1_000_000}MB limit.`,
      suggestion: 'Delete unused blobs with DELETE /blobs/{id} to free up space.',
    }, ctx.origin);
  }

  // Per-workspace storage cap (work/031), on top of the per-artifact limit above.
  const wsQuota = await checkStorageQuota(ctx.env, ctx.artifactId, actualSize);
  if (!wsQuota.allowed) {
    return errorResponse(storageQuotaError(wsQuota), ctx.origin);
  }

  await ctx.env.ARTIFACTS.put(token.r2_key, body, {
    httpMetadata: { contentType: token.mime_type },
  });

  const now = new Date().toISOString();
  const blobId = generateId('blob');

  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`
      INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(blobId, ctx.artifactId, token.filename, token.mime_type, token.r2_key, body.byteLength, now),
    ctx.env.DB.prepare(`
      UPDATE upload_tokens SET used_at = ? WHERE id = ?
    `).bind(now, tokenId),
    ctx.env.DB.prepare(`
      INSERT INTO artifact_storage (artifact_id, used_bytes, blob_count, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(artifact_id) DO UPDATE SET
        used_bytes = used_bytes + ?,
        blob_count = blob_count + 1,
        updated_at = ?
    `).bind(ctx.artifactId, body.byteLength, now, body.byteLength, now),
  ]);

  return successResponse({
    id: blobId,
    filename: token.filename,
    mimeType: token.mime_type,
    sizeBytes: body.byteLength,
    createdAt: now,
  }, 201, ctx.origin);
}

export function isAllowedMimeType(mimeType: string, allowAny = false): boolean {
  // Asset buckets accept any MIME — executable/script *extensions* are still
  // blocked by validateFilename, and everything non-media serves as a download.
  if (allowAny) return true;
  if (ALLOWED_MIME_TYPES.includes(mimeType)) return true;
  return ALLOWED_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix));
}

function hasBlockedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return BLOCKED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function validateFilename(filename: string): string | null {
  if (!filename) return 'Filename is required';
  if (filename.length > MAX_FILENAME_LENGTH) return `Filename too long (max ${MAX_FILENAME_LENGTH} chars)`;
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return 'Invalid filename';
  if (!FILENAME_PATTERN.test(filename)) return 'Filename contains invalid characters (allowed: letters, numbers, spaces, _ - . ( ) [ ])';
  if (hasBlockedExtension(filename)) return 'File type not allowed';
  return null;
}

// Extension fallback for callers whose MIME is unreliable (mail clients, share sheets).
const EXTENSION_MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
};

export function mimeFromFilename(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  return EXTENSION_MIME[ext] || 'application/octet-stream';
}

export interface DirectIngestResult {
  ok: boolean;
  blobId?: string;
  mimeType?: string;
  sizeBytes?: number;
  error?: string;
}

/**
 * Server-side blob creation into an asset bucket — no upload token, bytes in hand.
 * Used by email-in ingestion and the PWA share_target handler. Enforces the same
 * filename/MIME validation, bucket limits, and workspace quota as the upload path.
 */
export async function ingestBlobDirect(
  env: Env,
  artifactId: string,
  file: { filename: string; mimeType?: string; bytes: ArrayBuffer }
): Promise<DirectIngestResult> {
  const filenameError = validateFilename(file.filename);
  if (filenameError) return { ok: false, error: filenameError };

  let mimeType = file.mimeType || '';
  if (!mimeType || mimeType === 'application/octet-stream' || !isAllowedMimeType(mimeType, true)) {
    mimeType = mimeFromFilename(file.filename);
  }

  const size = file.bytes.byteLength;
  if (size > BUCKET_FILE_SIZE) {
    return { ok: false, error: `File too large (max ${BUCKET_FILE_SIZE / 1_000_000}MB)` };
  }

  const storage = await env.DB.prepare(
    'SELECT * FROM artifact_storage WHERE artifact_id = ?'
  ).bind(artifactId).first<StorageRow>()
    ?? { artifact_id: artifactId, used_bytes: 0, blob_count: 0 };

  if (storage.blob_count >= BUCKET_BLOBS) return { ok: false, error: 'Bucket blob limit reached' };
  if (storage.used_bytes + size > BUCKET_STORAGE) return { ok: false, error: 'Bucket storage limit reached' };

  const wsQuota = await checkStorageQuota(env, artifactId, size);
  if (!wsQuota.allowed) return { ok: false, error: storageQuotaError(wsQuota).message };

  const now = new Date().toISOString();
  const blobId = generateId('blob');
  const r2Key = `${artifactId}/blobs/${blobId}/${file.filename}`;

  await env.ARTIFACTS.put(r2Key, file.bytes, { httpMetadata: { contentType: mimeType } });

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(blobId, artifactId, file.filename, mimeType, r2Key, size, now),
    env.DB.prepare(`
      INSERT INTO artifact_storage (artifact_id, used_bytes, blob_count, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(artifact_id) DO UPDATE SET
        used_bytes = used_bytes + ?,
        blob_count = blob_count + 1,
        updated_at = ?
    `).bind(artifactId, size, now, size, now),
  ]);

  return { ok: true, blobId, mimeType, sizeBytes: size };
}

async function getOrCreateStorage(ctx: DataContext): Promise<StorageRow> {
  const existing = await ctx.env.DB.prepare(
    'SELECT * FROM artifact_storage WHERE artifact_id = ?'
  ).bind(ctx.artifactId).first<StorageRow>();

  if (existing) return existing;

  return { artifact_id: ctx.artifactId, used_bytes: 0, blob_count: 0 };
}

async function listBlobs(request: Request, ctx: DataContext): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 1000);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const result = await ctx.env.DB.prepare(`
    SELECT id, filename, mime_type, size_bytes, created_at
    FROM blobs WHERE artifact_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(ctx.artifactId, limit, offset).all<BlobRow>();

  const countResult = await ctx.env.DB.prepare(
    'SELECT COUNT(*) as count FROM blobs WHERE artifact_id = ?'
  ).bind(ctx.artifactId).first<{ count: number }>();

  return successResponse({
    blobs: result.results.map(b => ({
      id: b.id,
      filename: b.filename,
      mimeType: b.mime_type,
      sizeBytes: b.size_bytes,
      createdAt: b.created_at,
    })),
    total: countResult?.count || 0,
    limit,
    offset,
  }, 200, ctx.origin);
}

async function getBlobMetadata(ctx: DataContext, id: string): Promise<Response> {
  const blob = await ctx.env.DB.prepare(`
    SELECT id, filename, mime_type, size_bytes, created_at
    FROM blobs WHERE artifact_id = ? AND id = ?
  `).bind(ctx.artifactId, id).first<BlobRow>();

  if (!blob) {
    return errorResponse({
      ...DATA_ERRORS.BLOB_NOT_FOUND,
      hint: `No blob found with ID "${id}".`,
      suggestion: 'Use GET /blobs to list all blobs and verify the ID.',
    }, ctx.origin);
  }

  return successResponse({
    id: blob.id,
    filename: blob.filename,
    mimeType: blob.mime_type,
    sizeBytes: blob.size_bytes,
    createdAt: blob.created_at,
    contentUrl: `/v1/data/${ctx.artifactId}/blobs/${id}/content`,
  }, 200, ctx.origin);
}

async function getBlobContent(ctx: DataContext, id: string): Promise<Response> {
  const blob = await ctx.env.DB.prepare(`
    SELECT b.r2_key, b.mime_type, b.size_bytes, b.filename, d.visibility AS deliverable_visibility
    FROM blobs b
    LEFT JOIN asset_deliverables d ON d.id = b.deliverable_id AND d.deleted_at IS NULL
    WHERE b.artifact_id = ? AND b.id = ?
  `).bind(ctx.artifactId, id).first<BlobRow & { deliverable_visibility: string | null }>();

  if (!blob) {
    return errorResponse({
      ...DATA_ERRORS.BLOB_NOT_FOUND,
      hint: `No blob found with ID "${id}".`,
      suggestion: 'Use GET /blobs to list all blobs and verify the ID.',
    }, ctx.origin);
  }

  // A private File (asset_deliverable) must not serve bytes via this raw, per-bucket
  // route — the asset bucket is public (stable blob URLs), so this path resolves NO
  // per-viewer identity and can't tell owner from stranger. Force all private-file access
  // through the
  // identity-checked /v1/files/:id/content route (byte-level deny, work/042 P3).
  // ponytail: blunt 403 here is correct precisely because this route can't authenticate.
  if (blob.deliverable_visibility === 'private') {
    return errorResponse({
      ...DATA_ERRORS.FORBIDDEN,
      message: 'This file is private.',
      hint: 'Fetch it through GET /v1/files/{deliverableId}/content, which verifies the viewer.',
    }, ctx.origin);
  }

  const fileMissing = () => errorResponse({
    code: 'BLOB_FILE_MISSING',
    message: 'Blob file not found in storage',
    status: 404,
    hint: 'The blob metadata exists but the file content is missing from storage.',
    suggestion: 'The file may have been corrupted or deleted. Try re-uploading.',
  }, ctx.origin);

  // Public blob bytes are identical for every viewer and immutable per r2_key,
  // so edge-cache them (008 Stage A). Browsers keep the long immutable cache unchanged;
  // s-maxage gives the shared edge cache a real TTL so it actually stores the object,
  // bounded to the same 300s window as the artifact-visibility KV cache (middleware.ts)
  // so a public→private flip stops edge-serving within that window. Private/workspace
  // bytes keep today's header and are NEVER edge-cached (the cache is keyed by object,
  // not viewer).
  const isPublic = ctx.artifact.visibility === 'public';
  const inline = isInlineType(blob.mime_type);

  const buildResponse = (obj: R2ObjectBody) => new Response(obj.body, {
    headers: {
      'Content-Type': blob.mime_type,
      'Content-Length': String(blob.size_bytes),
      // Only safe, displayable media renders inline; docs/archives/anything else
      // download, with nosniff so the browser can't reinterpret them as active
      // content on the serving domain.
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${blob.filename}"`,
      ...(inline ? {} : { 'X-Content-Type-Options': 'nosniff' }),
      'Cache-Control': isPublic
        ? 'public, max-age=31536000, immutable, s-maxage=300'
        : 'public, max-age=31536000, immutable',
      ...corsHeaders(ctx.origin),
    },
  });

  if (isPublic) {
    const cached = await serveCachedR2Bytes(ctx.env, blob.r2_key, buildResponse, ctx.waitUntil);
    return cached ?? fileMissing();
  }

  const obj = await ctx.env.ARTIFACTS.get(blob.r2_key);
  if (!obj) return fileMissing();
  return buildResponse(obj);
}

async function requestUpload(request: Request, ctx: DataContext): Promise<Response> {
  let body: { filename?: string; mimeType?: string; size?: number };
  try {
    body = await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }

  const { filename, mimeType, size } = body;

  if (!filename) {
    return errorResponse(Errors.missingParam('filename', 'my-image.png'), ctx.origin);
  }

  const filenameError = validateFilename(filename);
  if (filenameError) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_FILENAME,
      message: filenameError,
      hint: `"${filename}" is not a valid filename.`,
    }, ctx.origin);
  }

  if (!mimeType) {
    return errorResponse(Errors.missingParam('mimeType', 'image/png'), ctx.origin);
  }

  if (!isAllowedMimeType(mimeType, ctx.assetBucket)) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_MIME_TYPE,
      hint: `"${mimeType}" is not an allowed MIME type.`,
      suggestion: 'Allowed: image/*, video/*, audio/*, application/pdf, text/plain, text/csv, text/markdown.',
    }, ctx.origin);
  }

  const limits = blobLimits(ctx);
  const fileSize = size || limits.maxFile;
  if (fileSize > limits.maxFile) {
    return errorResponse(
      Errors.formatSize('FILE_TOO_LARGE', 'File too large', limits.maxFile, fileSize),
      ctx.origin
    );
  }

  const storage = await getOrCreateStorage(ctx);

  if (storage.blob_count >= limits.maxCount) {
    return errorResponse({
      ...DATA_ERRORS.BLOB_LIMIT_EXCEEDED,
      hint: `Current blob count: ${storage.blob_count}/${limits.maxCount}.`,
    }, ctx.origin);
  }

  if (storage.used_bytes + fileSize > limits.maxStorage) {
    return errorResponse({
      ...DATA_ERRORS.STORAGE_LIMIT_EXCEEDED,
      hint: `Current usage: ${(storage.used_bytes / 1_000_000).toFixed(2)}MB. Requested: ${(fileSize / 1_000_000).toFixed(2)}MB. Limit: ${limits.maxStorage / 1_000_000}MB.`,
      suggestion: 'Delete unused blobs or reduce file size.',
    }, ctx.origin);
  }

  // Per-workspace storage cap (work/031), on top of the per-artifact limit above. Only
  // enforced when the caller declared a real size; otherwise the authoritative gate is the
  // confirm step (real obj.size), mirroring how datasets defer to confirm.
  if (size && size > 0) {
    const wsQuota = await checkStorageQuota(ctx.env, ctx.artifactId, size);
    if (!wsQuota.allowed) {
      return errorResponse(storageQuotaError(wsQuota), ctx.origin);
    }
  }

  const tokenId = generateId('upl');
  const r2Key = `${ctx.artifactId}/blobs/${tokenId}/${filename}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await ctx.env.DB.prepare(`
    INSERT INTO upload_tokens (id, kind, artifact_id, filename, mime_type, r2_key, max_size, expires_at)
    VALUES (?, 'blob', ?, ?, ?, ?, ?, ?)
  `).bind(tokenId, ctx.artifactId, filename, mimeType, r2Key, fileSize, expiresAt).run();

  // Heavy path: presigned PUT direct to R2 (Worker never sees the bytes). The client
  // PUTs the file, then POSTs /blobs/{tokenId}/confirm to persist metadata. Falls
  // back to the Worker-proxied _upload endpoint when R2 S3 creds are unconfigured.
  //
  // Browsers can't CORS-PUT directly to R2 — sandboxed artifacts send an opaque
  // `Origin: null` and no R2 bucket CORS rule covers them, so the preflight fails.
  // Route any browser upload (Origin header present) through the Worker-proxied
  // path, which already serves the artifact's CORS. Direct-to-R2 is kept for
  // non-browser callers (CLI/server, no Origin) where it's fastest and CORS-free.
  const fromBrowser = !!request.headers.get('Origin');
  const presignedPut = fromBrowser ? null : await presignPut(ctx.env, r2Key);
  if (presignedPut) {
    return successResponse({
      uploadUrl: presignedPut,
      confirmUrl: `/v1/data/${ctx.artifactId}/blobs/${tokenId}/confirm`,
      tokenId,
      direct: true,
      expiresAt,
      maxSize: fileSize,
    }, 201, ctx.origin);
  }

  const baseUrl = getBaseUrl(request);
  const uploadUrl = `${baseUrl}/v1/data/${ctx.artifactId}/blobs/_upload/${tokenId}`;

  return successResponse({
    uploadUrl,
    tokenId,
    direct: false,
    expiresAt,
    maxSize: fileSize,
  }, 201, ctx.origin);
}

async function confirmBlobUpload(ctx: DataContext, tokenId: string): Promise<Response> {
  const token = await ctx.env.DB.prepare(`
    SELECT * FROM upload_tokens
    WHERE id = ? AND kind = 'blob' AND artifact_id = ? AND used_at IS NULL
  `).bind(tokenId, ctx.artifactId).first<UploadTokenRow>();

  if (!token) {
    return errorResponse({
      ...DATA_ERRORS.UPLOAD_TOKEN_INVALID,
      hint: `Token "${tokenId}" is invalid, expired, or already used.`,
    }, ctx.origin);
  }

  if (new Date(token.expires_at) < new Date()) {
    return errorResponse({
      ...DATA_ERRORS.UPLOAD_TOKEN_EXPIRED,
      hint: `Token expired at ${token.expires_at}.`,
    }, ctx.origin);
  }

  const obj = await ctx.env.ARTIFACTS.head(token.r2_key);
  if (!obj) {
    return errorResponse({
      code: 'UPLOAD_INCOMPLETE',
      message: 'File not uploaded yet',
      status: 400,
      hint: 'The upload token exists but no file has been uploaded to it.',
      suggestion: 'PUT the file content to the uploadUrl before calling confirm.',
    }, ctx.origin);
  }

  // Direct-to-R2 bypasses the Worker, so the declared size at token creation is
  // unverified — the client can PUT a file larger than token.max_size. obj.size is
  // the real size; enforce the per-file cap here and delete the oversized orphan.
  if (obj.size > token.max_size) {
    await ctx.env.ARTIFACTS.delete(token.r2_key);
    return errorResponse(
      Errors.formatSize('FILE_TOO_LARGE', 'File too large', token.max_size, obj.size),
      ctx.origin
    );
  }

  const storage = await getOrCreateStorage(ctx);
  const confirmMax = blobLimits(ctx).maxStorage;
  if (storage.used_bytes + obj.size > confirmMax) {
    await ctx.env.ARTIFACTS.delete(token.r2_key);
    return errorResponse({
      ...DATA_ERRORS.STORAGE_LIMIT_EXCEEDED,
      hint: `Adding ${(obj.size / 1_000_000).toFixed(2)}MB would exceed ${confirmMax / 1_000_000}MB.`,
    }, ctx.origin);
  }

  // Per-workspace storage cap (work/031). File is already in R2 (presigned PUT), so delete
  // the orphan on reject, same as the per-artifact check above.
  const wsQuota = await checkStorageQuota(ctx.env, ctx.artifactId, obj.size);
  if (!wsQuota.allowed) {
    await ctx.env.ARTIFACTS.delete(token.r2_key);
    return errorResponse(storageQuotaError(wsQuota), ctx.origin);
  }

  const now = new Date().toISOString();
  const blobId = generateId('blob');

  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`
      INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(blobId, ctx.artifactId, token.filename, token.mime_type, token.r2_key, obj.size, now),
    ctx.env.DB.prepare(`
      UPDATE upload_tokens SET used_at = ? WHERE id = ?
    `).bind(now, tokenId),
    ctx.env.DB.prepare(`
      INSERT INTO artifact_storage (artifact_id, used_bytes, blob_count, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(artifact_id) DO UPDATE SET
        used_bytes = used_bytes + ?,
        blob_count = blob_count + 1,
        updated_at = ?
    `).bind(ctx.artifactId, obj.size, now, obj.size, now),
  ]);

  return successResponse({
    id: blobId,
    filename: token.filename,
    mimeType: token.mime_type,
    sizeBytes: obj.size,
    createdAt: now,
  }, 201, ctx.origin);
}

async function getBlobDownloadUrl(ctx: DataContext, id: string): Promise<Response> {
  const blob = await ctx.env.DB.prepare(`
    SELECT r2_key, mime_type FROM blobs WHERE artifact_id = ? AND id = ?
  `).bind(ctx.artifactId, id).first<BlobRow>();

  if (!blob) {
    return errorResponse({
      ...DATA_ERRORS.BLOB_NOT_FOUND,
      hint: `No blob found with ID "${id}".`,
    }, ctx.origin);
  }

  // Presigned GET direct from R2 (bytes bypass the Worker). dataMiddleware already
  // enforced artifact auth before reaching here. Falls back to the Worker content URL.
  const presigned = await presignGet(ctx.env, blob.r2_key);
  return successResponse({
    url: presigned || `/v1/data/${ctx.artifactId}/blobs/${id}/content`,
    direct: !!presigned,
    expiresIn: presigned ? 300 : null,
  }, 200, ctx.origin);
}

async function deleteBlob(ctx: DataContext, id: string): Promise<Response> {
  const blob = await ctx.env.DB.prepare(`
    SELECT id, r2_key, size_bytes FROM blobs WHERE artifact_id = ? AND id = ?
  `).bind(ctx.artifactId, id).first<BlobRow>();

  if (!blob) {
    return errorResponse({
      ...DATA_ERRORS.BLOB_NOT_FOUND,
      hint: `No blob found with ID "${id}".`,
      suggestion: 'Use GET /blobs to list all blobs and verify the ID.',
    }, ctx.origin);
  }

  await ctx.env.ARTIFACTS.delete(blob.r2_key);

  const now = new Date().toISOString();

  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM blobs WHERE id = ?').bind(id),
    ctx.env.DB.prepare(`
      UPDATE artifact_storage SET
        used_bytes = MAX(0, used_bytes - ?),
        blob_count = MAX(0, blob_count - 1),
        updated_at = ?
      WHERE artifact_id = ?
    `).bind(blob.size_bytes, now, ctx.artifactId),
  ]);

  return successResponse({ deleted: true }, 200, ctx.origin);
}

async function getStorageUsage(ctx: DataContext): Promise<Response> {
  const storage = await getOrCreateStorage(ctx);
  const limits = blobLimits(ctx);

  return successResponse({
    usedBytes: storage.used_bytes,
    blobCount: storage.blob_count,
    maxBytes: limits.maxStorage,
    maxBlobs: limits.maxCount,
    availableBytes: limits.maxStorage - storage.used_bytes,
  }, 200, ctx.origin);
}

function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
