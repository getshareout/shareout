import type { Env } from '../../types';
import { DATA_ERRORS } from '../../types';
import { generateId, sha256 } from '../../crypto-utils';
import {
  successResponse,
  errorResponse,
  verifyOwner,
  type DataContext,
} from '../middleware';
import { Errors } from '../errors';
import { presignGet, presignPut } from '../r2-presign';
import { serveCachedR2Bytes } from '../r2-cache';
import { readDatasetPage, DatasetTooLargeError } from './paginate';
import { checkStorageQuota, storageQuotaError } from '../../storage-quota';

const MAX_DATASET_SIZE = 500_000_000; // 500MB — presigned PUT goes direct to R2; the
// Worker-proxied fallback streams the body (never buffers it), so neither path materializes
// the whole file in the isolate. Storage is metered + billed per workspace (storage rollup).
const NAME_PATTERN = /^[a-zA-Z0-9_\-\.]+$/;
const ALLOWED_FORMATS = ['json', 'csv'] as const;
type DatasetFormat = (typeof ALLOWED_FORMATS)[number];

interface DatasetRow {
  id: string;
  artifact_id: string;
  name: string;
  format: string;
  r2_key: string;
  size_bytes: number;
  sha256: string;
  version: number;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

interface UploadTokenRow {
  id: string;
  artifact_id: string;
  dataset_name: string;
  format: string;
  r2_key: string;
  expires_at: string;
  used_at: string | null;
}

export async function handleDatasets(
  request: Request,
  ctx: DataContext,
  path: string
): Promise<Response> {
  const parts = path.split('/').filter(Boolean);
  const [name, action] = parts;
  const method = request.method;

  if (!name && method === 'GET') {
    return listDatasets(ctx);
  }

  if (name === 'upload-url' && method === 'POST') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return generateUploadUrl(request, ctx);
  }

  if (action === 'confirm' && method === 'POST') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return confirmUpload(request, ctx, name);
  }

  if (action === 'content' && method === 'GET') {
    return getDatasetContent(request, ctx, name);
  }

  if (action === 'stream' && method === 'GET') {
    return streamDataset(ctx, name);
  }

  if (action === 'download-url' && method === 'GET') {
    return getDatasetDownloadUrl(ctx, name);
  }

  if (name && !action && method === 'GET') {
    return getDatasetMetadata(ctx, name);
  }

  if (name && !action && method === 'DELETE') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return deleteDataset(ctx, name);
  }

  return errorResponse(DATA_ERRORS.NOT_FOUND);
}

function validateName(name: string): string | null {
  if (!name) return 'Name is required';
  if (name.length > 64) return 'Name too long (max 64 chars)';
  if (!NAME_PATTERN.test(name)) return 'Name contains invalid characters';
  return null;
}

async function listDatasets(ctx: DataContext): Promise<Response> {
  const result = await ctx.env.DB.prepare(
    'SELECT name, format, size_bytes, version, updated_at FROM datasets WHERE artifact_id = ? ORDER BY name'
  ).bind(ctx.artifactId).all<{
    name: string;
    format: string;
    size_bytes: number;
    version: number;
    updated_at: string;
  }>();

  return successResponse({
    datasets: result.results.map(r => ({
      name: r.name,
      format: r.format,
      sizeBytes: r.size_bytes,
      version: r.version,
      updatedAt: r.updated_at,
    })),
    count: result.results.length,
  });
}

async function getDatasetMetadata(
  ctx: DataContext,
  name: string
): Promise<Response> {
  const nameError = validateName(name);
  if (nameError) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_DATASET_NAME,
      message: nameError,
      hint: `"${name}" is not a valid dataset name.`,
    }, ctx.origin);
  }

  const dataset = await ctx.env.DB.prepare(
    'SELECT name, format, size_bytes, version, metadata, created_at, updated_at FROM datasets WHERE artifact_id = ? AND name = ?'
  ).bind(ctx.artifactId, name).first<DatasetRow>();

  if (!dataset) {
    return errorResponse({
      ...DATA_ERRORS.DATASET_NOT_FOUND,
      hint: `No dataset named "${name}" exists.`,
      suggestion: 'Use GET /datasets to list all available datasets.',
    }, ctx.origin);
  }

  return successResponse({
    name: dataset.name,
    format: dataset.format,
    sizeBytes: dataset.size_bytes,
    version: dataset.version,
    metadata: dataset.metadata ? JSON.parse(dataset.metadata) : null,
    createdAt: dataset.created_at,
    updatedAt: dataset.updated_at,
  });
}

async function generateUploadUrl(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  let body: { name?: string; format?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }

  const { name, format } = body;

  if (!name) {
    return errorResponse(Errors.missingParam('name', 'sales_data'), ctx.origin);
  }

  const nameError = validateName(name);
  if (nameError) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_DATASET_NAME,
      message: nameError,
      hint: `"${name}" is not a valid dataset name.`,
    }, ctx.origin);
  }

  if (!format || !ALLOWED_FORMATS.includes(format as DatasetFormat)) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_FORMAT,
      hint: format ? `"${format}" is not a supported format.` : 'Format is required.',
      suggestion: `Supported formats: ${ALLOWED_FORMATS.join(', ')}.`,
    }, ctx.origin);
  }

  const uploadId = generateId('upl');
  const r2Key = `${ctx.artifactId}/datasets/${name}/${uploadId}.${format}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

  await ctx.env.DB.prepare(`
    INSERT INTO upload_tokens (id, kind, artifact_id, dataset_name, format, r2_key, expires_at)
    VALUES (?, 'dataset', ?, ?, ?, ?, ?)
  `).bind(uploadId, ctx.artifactId, name, format, r2Key, expiresAt).run();

  // Presigned PUT direct to R2 when configured; the existing confirm step persists
  // metadata after the upload. Falls back to the Worker-proxied _upload endpoint.
  const presignedPut = await presignPut(ctx.env, r2Key);
  if (presignedPut) {
    return successResponse({
      uploadId,
      uploadUrl: presignedPut,
      confirmUrl: `/v1/data/${ctx.artifactId}/datasets/${name}/confirm`,
      r2Key,
      direct: true,
      expiresAt,
      maxSize: MAX_DATASET_SIZE,
    }, 201);
  }

  const uploadUrl = `${getBaseUrl(request)}/v1/data/${ctx.artifactId}/datasets/_upload/${uploadId}`;

  return successResponse({
    uploadId,
    uploadUrl,
    r2Key,
    direct: false,
    expiresAt,
    maxSize: MAX_DATASET_SIZE,
  }, 201);
}

async function getDatasetDownloadUrl(
  ctx: DataContext,
  name: string
): Promise<Response> {
  const dataset = await ctx.env.DB.prepare(
    'SELECT r2_key, format FROM datasets WHERE artifact_id = ? AND name = ?'
  ).bind(ctx.artifactId, name).first<DatasetRow>();

  if (!dataset) {
    return errorResponse({
      ...DATA_ERRORS.DATASET_NOT_FOUND,
      hint: `No dataset named "${name}" exists.`,
    }, ctx.origin);
  }

  // Presigned GET: the browser fetches the whole extract directly from R2 and filters
  // client-side. dataMiddleware enforced auth. Falls back to the Worker stream URL.
  const presigned = await presignGet(ctx.env, dataset.r2_key);
  return successResponse({
    url: presigned || `/v1/data/${ctx.artifactId}/datasets/${name}/stream`,
    format: dataset.format,
    direct: !!presigned,
    expiresIn: presigned ? 300 : null,
  });
}

async function confirmUpload(
  request: Request,
  ctx: DataContext,
  name: string
): Promise<Response> {
  let body: { uploadId?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }

  const { uploadId } = body;
  if (!uploadId) {
    return errorResponse(Errors.missingParam('uploadId', 'upl_abc123'), ctx.origin);
  }

  const token = await ctx.env.DB.prepare(`
    SELECT * FROM upload_tokens
    WHERE id = ? AND kind = 'dataset' AND artifact_id = ? AND dataset_name = ? AND used_at IS NULL
  `).bind(uploadId, ctx.artifactId, name).first<UploadTokenRow>();

  if (!token) {
    return errorResponse({
      ...DATA_ERRORS.UPLOAD_TOKEN_INVALID,
      hint: `Token "${uploadId}" is invalid, expired, or already used.`,
      suggestion: 'Request a new upload URL via POST /datasets/upload-url.',
    }, ctx.origin);
  }

  if (new Date(token.expires_at) < new Date()) {
    return errorResponse({
      ...DATA_ERRORS.UPLOAD_TOKEN_EXPIRED,
      hint: `Token expired at ${token.expires_at}.`,
      suggestion: 'Request a new upload URL and complete upload within 15 minutes.',
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

  const existing = await ctx.env.DB.prepare(
    'SELECT id, version, size_bytes FROM datasets WHERE artifact_id = ? AND name = ?'
  ).bind(ctx.artifactId, name).first<{ id: string; version: number; size_bytes: number }>();

  // Enforce the workspace's storage cap before registering the upload. The file is already
  // in R2 (presigned PUT or _upload), so on reject we delete the orphan to reclaim space.
  const quota = await checkStorageQuota(ctx.env, ctx.artifactId, obj.size, existing?.size_bytes ?? 0);
  if (!quota.allowed) {
    await ctx.env.ARTIFACTS.delete(token.r2_key);
    return errorResponse(storageQuotaError(quota), ctx.origin);
  }

  const metadata = await extractMetadata(ctx.env.ARTIFACTS, token.r2_key, token.format, obj.size);

  const now = new Date().toISOString();
  const hash = obj.httpEtag || '';

  if (existing) {
    await ctx.env.DB.prepare(`
      UPDATE datasets SET
        r2_key = ?, size_bytes = ?, sha256 = ?, version = version + 1,
        metadata = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      token.r2_key, obj.size, hash, JSON.stringify(metadata), now, existing.id
    ).run();
  } else {
    const id = generateId('dst');
    await ctx.env.DB.prepare(`
      INSERT INTO datasets (id, artifact_id, name, format, r2_key, size_bytes, sha256, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, ctx.artifactId, name, token.format, token.r2_key, obj.size, hash,
      JSON.stringify(metadata), now, now
    ).run();
  }

  await ctx.env.DB.prepare(
    'UPDATE upload_tokens SET used_at = ? WHERE id = ?'
  ).bind(now, uploadId).run();

  return successResponse({
    name,
    format: token.format,
    version: (existing?.version || 0) + 1,
    sizeBytes: obj.size,
    ...metadata,
  });
}

async function getDatasetContent(
  request: Request,
  ctx: DataContext,
  name: string
): Promise<Response> {
  const url = new URL(request.url);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000', 10), 10000);

  const dataset = await ctx.env.DB.prepare(
    'SELECT r2_key, format, size_bytes, metadata FROM datasets WHERE artifact_id = ? AND name = ?'
  ).bind(ctx.artifactId, name).first<DatasetRow>();

  if (!dataset) {
    return errorResponse({
      ...DATA_ERRORS.DATASET_NOT_FOUND,
      hint: `No dataset named "${name}" exists.`,
      suggestion: 'Use GET /datasets to list all available datasets.',
    }, ctx.origin);
  }

  const obj = await ctx.env.ARTIFACTS.get(dataset.r2_key);
  if (!obj) {
    return errorResponse({
      code: 'DATASET_FILE_MISSING',
      message: 'Dataset file not found in storage',
      status: 404,
      hint: 'The dataset metadata exists but the file content is missing.',
      suggestion: 'Re-upload the dataset.',
    }, ctx.origin);
  }

  // Stream the object and retain only the requested page window, so peak memory is
  // bounded by the page size regardless of file size — no more whole-file buffer/parse
  // OOM (008 Stage B1). `total` is still computed by counting every record. The only
  // un-streamable shape — a single non-array JSON value larger than the cap — throws.
  let result: { page: unknown[]; total: number };
  try {
    result = await readDatasetPage(obj.body, dataset.format, offset, limit);
  } catch (err) {
    if (err instanceof DatasetTooLargeError) {
      return errorResponse({
        code: 'DATASET_TOO_LARGE_TO_PAGE',
        message: 'Dataset is too large to read via the paged content endpoint',
        status: 413,
        hint: 'This dataset is a single JSON value too large to parse in the Worker.',
        suggestion: `Fetch the whole extract via GET /datasets/${name}/download-url (direct from R2) or GET /datasets/${name}/stream and filter client-side.`,
      }, ctx.origin);
    }
    throw err;
  }

  return successResponse({
    data: result.page,
    total: result.total,
    offset,
    limit,
    hasMore: offset + limit < result.total,
  });
}

async function streamDataset(
  ctx: DataContext,
  name: string
): Promise<Response> {
  const dataset = await ctx.env.DB.prepare(
    'SELECT r2_key, format, size_bytes FROM datasets WHERE artifact_id = ? AND name = ?'
  ).bind(ctx.artifactId, name).first<DatasetRow>();

  if (!dataset) {
    return errorResponse({
      ...DATA_ERRORS.DATASET_NOT_FOUND,
      hint: `No dataset named "${name}" exists.`,
      suggestion: 'Use GET /datasets to list all available datasets.',
    }, ctx.origin);
  }

  const contentType = dataset.format === 'json' ? 'application/json' : 'text/csv';
  const fileMissing = () => errorResponse({
    code: 'DATASET_FILE_MISSING',
    message: 'Dataset file not found in storage',
    status: 404,
    hint: 'The dataset metadata exists but the file is missing.',
    suggestion: 'Re-upload the dataset.',
  }, ctx.origin);

  // Public dataset streams are immutable per r2_key and already CORS-open, so
  // edge-cache them for cross-viewer hits (008 Stage A). Private bytes stay uncached.
  const isPublic = ctx.artifact.visibility === 'public';

  const buildResponse = (obj: R2ObjectBody) => new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(obj.size),
      'Access-Control-Allow-Origin': '*',
      ...(isPublic ? { 'Cache-Control': 'public, max-age=31536000, immutable, s-maxage=300' } : {}),
    },
  });

  if (isPublic) {
    const cached = await serveCachedR2Bytes(ctx.env, dataset.r2_key, buildResponse, ctx.waitUntil);
    return cached ?? fileMissing();
  }

  const obj = await ctx.env.ARTIFACTS.get(dataset.r2_key);
  if (!obj) return fileMissing();
  return buildResponse(obj);
}

async function deleteDataset(
  ctx: DataContext,
  name: string
): Promise<Response> {
  const dataset = await ctx.env.DB.prepare(
    'SELECT id, r2_key FROM datasets WHERE artifact_id = ? AND name = ?'
  ).bind(ctx.artifactId, name).first<{ id: string; r2_key: string }>();

  if (!dataset) {
    return errorResponse({
      ...DATA_ERRORS.DATASET_NOT_FOUND,
      hint: `No dataset named "${name}" exists or it was already deleted.`,
      suggestion: 'Use GET /datasets to verify the dataset exists.',
    }, ctx.origin);
  }

  await ctx.env.ARTIFACTS.delete(dataset.r2_key);

  await ctx.env.DB.prepare(
    'DELETE FROM datasets WHERE id = ?'
  ).bind(dataset.id).run();

  return successResponse({ deleted: true });
}

// Bytes read to extract column names: header line / first JSON element fit comfortably.
const COLUMN_SAMPLE_BYTES = 64 * 1024;
// Below this, count every row inline (cheap). Above it, defer rowCount (null) so confirm
// cost stays flat up to the 500MB cap — a full streaming count of millions of rows would
// burn the request's CPU budget. getDatasetContent computes `total` live per page anyway,
// so a null cached rowCount degrades gracefully.
const INLINE_ROWCOUNT_MAX_BYTES = 10_000_000;

// Metadata for confirm = rowCount + column names only; it never needs the parsed rows.
// readDatasetPage streams the R2 body and retains at most one row, so peak memory is
// bounded regardless of file size. The old path did obj.text() + a full parseCSV array +
// a second content.split('\n') copy — three whole-file materializations that blew the
// 128MB isolate (CF 1102) on a ~24MB/300k-row CSV. Because 1102 kills the isolate the
// try/catch never ran, so confirm 503'd instead of degrading. Any failure here (incl. the
// pathological single oversized JSON value → DatasetTooLargeError) degrades to a null
// rowCount / empty columns so the dataset row still persists — a registered dataset with
// unknown rowCount beats a hard 503.
async function extractMetadata(
  bucket: R2Bucket,
  r2Key: string,
  format: string,
  sizeBytes: number
): Promise<{ rowCount: number | null; columns: string[] }> {
  if (format !== 'csv' && format !== 'json') return { rowCount: null, columns: [] };
  const columnsOf = (first: unknown): string[] =>
    first && typeof first === 'object' ? Object.keys(first as Record<string, unknown>) : [];

  try {
    if (sizeBytes <= INLINE_ROWCOUNT_MAX_BYTES) {
      // One pass: first record → columns, and the full count.
      const obj = await bucket.get(r2Key);
      if (!obj) return { rowCount: null, columns: [] };
      const { page, total } = await readDatasetPage(obj.body, format, 0, 1);
      return { rowCount: total, columns: columnsOf(page[0]) };
    }

    // Large file: read only the leading window for columns; defer the row count.
    const range = await bucket.get(r2Key, { range: { offset: 0, length: COLUMN_SAMPLE_BYTES } });
    if (!range) return { rowCount: null, columns: [] };
    const { page } = await readDatasetPage(range.body, format, 0, 1);
    return { rowCount: null, columns: columnsOf(page[0]) };
  } catch {
    return { rowCount: null, columns: [] };
  }
}

function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function handleDatasetUpload(
  request: Request,
  ctx: DataContext,
  uploadId: string
): Promise<Response> {
  if (request.method !== 'PUT') {
    return errorResponse(Errors.methodNotAllowed(request.method, ['PUT']), ctx.origin);
  }

  const token = await ctx.env.DB.prepare(`
    SELECT * FROM upload_tokens
    WHERE id = ? AND kind = 'dataset' AND artifact_id = ? AND used_at IS NULL
  `).bind(uploadId, ctx.artifactId).first<UploadTokenRow>();

  if (!token) {
    return errorResponse({
      ...DATA_ERRORS.UPLOAD_TOKEN_INVALID,
      hint: `Token "${uploadId}" is invalid, expired, or already used.`,
      suggestion: 'Request a new upload URL via POST /datasets/upload-url.',
    }, ctx.origin);
  }

  if (new Date(token.expires_at) < new Date()) {
    return errorResponse({
      ...DATA_ERRORS.UPLOAD_TOKEN_EXPIRED,
      hint: `Token expired at ${token.expires_at}.`,
      suggestion: 'Request a new upload URL and upload within 15 minutes.',
    }, ctx.origin);
  }

  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_DATASET_SIZE) {
    return errorResponse(
      Errors.formatSize('FILE_TOO_LARGE', 'Dataset file too large', MAX_DATASET_SIZE, contentLength),
      ctx.origin
    );
  }

  // Reject over-cap uploads before streaming the bytes (confirm re-checks the actual size).
  if (contentLength > 0) {
    const existing = await ctx.env.DB.prepare(
      'SELECT size_bytes FROM datasets WHERE artifact_id = ? AND name = ?'
    ).bind(ctx.artifactId, token.dataset_name).first<{ size_bytes: number }>();
    const quota = await checkStorageQuota(ctx.env, ctx.artifactId, contentLength, existing?.size_bytes ?? 0);
    if (!quota.allowed) {
      return errorResponse(storageQuotaError(quota), ctx.origin);
    }
  }

  if (!request.body) {
    return errorResponse({
      code: 'UPLOAD_INCOMPLETE',
      message: 'Request has no body',
      status: 400,
      hint: 'PUT the file content as the request body.',
    }, ctx.origin);
  }

  const contentType = token.format === 'json' ? 'application/json' : 'text/csv';

  // Stream straight to R2 — never await request.arrayBuffer(), which would buffer the whole
  // (up to 500MB) file in the isolate and OOM. request.body carries its length from the
  // Content-Length header, which R2 requires for a streamed put.
  await ctx.env.ARTIFACTS.put(token.r2_key, request.body, {
    httpMetadata: { contentType },
  });

  return successResponse({ uploaded: true, r2Key: token.r2_key });
}

function serializeRows(rows: unknown[], format: DatasetFormat): string {
  if (format === 'json') return JSON.stringify(rows);

  // CSV: union of keys across rows as the header.
  const objs = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  const columns: string[] = [];
  for (const row of objs) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(',')];
  for (const row of objs) {
    lines.push(columns.map(c => escape(row[c])).join(','));
  }
  return lines.join('\n');
}

/**
 * Durably materialize an array of rows into a dataset (R2 file + datasets row,
 * version-incremented). Used by the materialize endpoint and scheduled refresh.
 * Writes the new R2 object before flipping the pointer, then GCs the old object.
 */
export async function writeDatasetRows(
  env: Env,
  artifactId: string,
  name: string,
  format: DatasetFormat,
  rows: unknown[]
): Promise<{ name: string; format: DatasetFormat; version: number; sizeBytes: number; rowCount: number }> {
  const nameError = validateName(name);
  if (nameError) throw new Error(nameError);
  if (!ALLOWED_FORMATS.includes(format)) throw new Error(`Unsupported format: ${format}`);

  const content = serializeRows(rows, format);
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > MAX_DATASET_SIZE) {
    throw new Error(`Materialized dataset exceeds ${MAX_DATASET_SIZE / 1_000_000}MB limit`);
  }

  const existing = await env.DB.prepare(
    'SELECT id, version, r2_key, size_bytes FROM datasets WHERE artifact_id = ? AND name = ?'
  ).bind(artifactId, name).first<{ id: string; version: number; r2_key: string; size_bytes: number }>();

  // Gate the materialized/refresh path against the storage cap too — a 5-min refresh of a
  // huge query would otherwise grow R2 unbounded. Checked before the R2 write.
  const quota = await checkStorageQuota(env, artifactId, bytes.byteLength, existing?.size_bytes ?? 0);
  if (!quota.allowed) {
    const detail = quota.reason === 'file_too_large'
      ? `exceeds this instance's ${quota.fileMax / 1_000_000}MB per-file limit`
      : `would exceed this instance's ${quota.max / 1_000_000}MB storage limit`;
    throw new Error(`Materialized dataset "${name}" ${detail}`);
  }

  const r2Key = `${artifactId}/datasets/${name}/${generateId('mat')}.${format}`;
  const contentType = format === 'json' ? 'application/json' : 'text/csv';
  await env.ARTIFACTS.put(r2Key, bytes, { httpMetadata: { contentType } });

  const hash = await sha256(bytes.buffer as ArrayBuffer);
  const columns = rows.length > 0 && rows[0] && typeof rows[0] === 'object'
    ? Object.keys(rows[0] as Record<string, unknown>)
    : [];
  const metadata = JSON.stringify({ rowCount: rows.length, columns });
  const now = new Date().toISOString();

  let version: number;
  if (existing) {
    version = existing.version + 1;
    await env.DB.prepare(`
      UPDATE datasets SET r2_key = ?, format = ?, size_bytes = ?, sha256 = ?,
        version = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `).bind(r2Key, format, bytes.byteLength, hash, version, metadata, now, existing.id).run();
    if (existing.r2_key && existing.r2_key !== r2Key) {
      await env.ARTIFACTS.delete(existing.r2_key);
    }
  } else {
    version = 1;
    await env.DB.prepare(`
      INSERT INTO datasets (id, artifact_id, name, format, r2_key, size_bytes, sha256, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(generateId('dst'), artifactId, name, format, r2Key, bytes.byteLength, hash, metadata, now, now).run();
  }

  return { name, format, version, sizeBytes: bytes.byteLength, rowCount: rows.length };
}
