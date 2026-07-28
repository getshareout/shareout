// GET /v1/files/:id/content — serve a File (asset_deliverable) by its stable dlv_ id,
// resolving to the latest version's bytes. This is the deliverable-keyed, identity-checked
// front door for files (work/042 P3): it lets an artifact embed a file by id (so.files.getUrl)
// without knowing the internal storage bucket, and enforces byte-level deny for private files.
//
// Access model:
//   private   → owner OR a direct 'file' grant (canAccess). Anonymous/others get 403.
//   workspace → served to anyone with the id (embeddable; the asset bucket is public, so
//               this matches the raw blob route it replaces). Identity is not resolved.
import type { Env } from '../types';
import { getSessionUser } from '../auth';
import { getVisibilityScope } from '../account-links';
import { canAccess } from '../access/can-access';
import { corsHeaders } from './middleware';
import { isInlineType } from './blobs/handler';
import { listFileUsage } from '../assets/usage';
import { jsonWithApiErrors } from '../http/api-error';

interface FileRow {
  bucket_artifact_id: string;
  owner_id: string | null;
  visibility: string;
  blob_id: string;
  r2_key: string;
  mime_type: string;
  size_bytes: number;
  filename: string;
  version_no: number;
}

export async function handleFileContent(request: Request, env: Env, deliverableId: string): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) as HeadersInit });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, origin);
  }

  // ?v=N pins a specific version (used by the version-history download); default = latest.
  // The `?v=` the lens appends to the latest url is the latest version number, so it also
  // acts as a cache-bust that stays byte-correct.
  const vParam = new URL(request.url).searchParams.get('v');
  const version = vParam && /^\d+$/.test(vParam) ? parseInt(vParam, 10) : null;
  const versionClause = version !== null
    ? 'b.version_no = ?'
    : 'b.version_no = (SELECT MAX(version_no) FROM blobs WHERE deliverable_id = d.id)';

  const row = await env.DB.prepare(`
    SELECT d.bucket_artifact_id, d.owner_id, d.visibility,
           b.id AS blob_id, b.r2_key, b.mime_type, b.size_bytes, b.filename, b.version_no
      FROM asset_deliverables d
      JOIN blobs b ON b.deliverable_id = d.id AND ${versionClause}
     WHERE d.id = ? AND d.deleted_at IS NULL
  `).bind(...(version !== null ? [version, deliverableId] : [deliverableId])).first<FileRow>();

  if (!row) {
    return json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404, origin);
  }

  if (row.visibility === 'private') {
    const allowed = await viewerCanReadPrivate(request, env, deliverableId, row.owner_id);
    if (!allowed) {
      return json({ error: 'This file is private.', code: 'FORBIDDEN' }, 403, origin);
    }
  }

  const obj = await env.ARTIFACTS.get(row.r2_key);
  if (!obj) {
    return json({ error: 'File content missing from storage', code: 'FILE_MISSING' }, 404, origin);
  }

  const inline = isInlineType(row.mime_type);
  return new Response(request.method === 'HEAD' ? null : obj.body, {
    headers: {
      'Content-Type': row.mime_type,
      'Content-Length': String(row.size_bytes),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${row.filename}"`,
      ...(inline ? {} : { 'X-Content-Type-Options': 'nosniff' }),
      // URL is dlv-keyed (stable across versions), so it must NOT be immutable-cached:
      // a new version reuses the same URL. Private bytes are never cached (per-viewer).
      'Cache-Control': row.visibility === 'private' ? 'no-store' : 'private, max-age=300',
      ...(corsHeaders(origin) as Record<string, string>),
    },
  });
}

// GET /v1/files/:id — file metadata (name, type, size, versions, AI enrichment, usage).
// Same access model as content: a private file's metadata is owner/grantee-only.
export async function handleFileMeta(request: Request, env: Env, deliverableId: string): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) as HeadersInit });
  if (request.method !== 'GET') return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, origin);

  const row = await env.DB.prepare(`
    SELECT d.name, d.owner_id, d.visibility, d.workspace_id, d.type_metadata,
           b.id AS blob_id, b.filename, b.mime_type, b.size_bytes, b.version_no,
           (SELECT COUNT(*) FROM blobs WHERE deliverable_id = d.id) AS version_count
      FROM asset_deliverables d
      JOIN blobs b ON b.deliverable_id = d.id
        AND b.version_no = (SELECT MAX(version_no) FROM blobs WHERE deliverable_id = d.id)
     WHERE d.id = ? AND d.deleted_at IS NULL
  `).bind(deliverableId).first<{
    name: string; owner_id: string | null; visibility: string; workspace_id: string | null; type_metadata: string | null;
    blob_id: string; filename: string; mime_type: string; size_bytes: number; version_no: number; version_count: number;
  }>();
  if (!row) return json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404, origin);

  if (row.visibility === 'private' && !(await viewerCanReadPrivate(request, env, deliverableId, row.owner_id))) {
    return json({ error: 'This file is private.', code: 'FORBIDDEN' }, 403, origin);
  }

  let enrichment: unknown = null;
  if (row.type_metadata) {
    try {
      const e = (JSON.parse(row.type_metadata) as { enrichment?: { blobId: string } }).enrichment;
      if (e && e.blobId === row.blob_id) enrichment = e; // hide stale
    } catch { /* ignore */ }
  }
  const usage = await listFileUsage(env, deliverableId);

  return json({
    id: deliverableId, name: row.name, filename: row.filename, mimeType: row.mime_type,
    sizeBytes: row.size_bytes, visibility: row.visibility, version: row.version_no, versionCount: row.version_count,
    contentUrl: `/v1/files/${deliverableId}/content`,
    enrichment, usedIn: usage,
  }, 200, origin);
}

// Owner or a direct/inherited 'file' grant. Uses the same session identity the shared
// portal resolves, so a sharee reading a directly-granted private file is authorized here.
async function viewerCanReadPrivate(
  request: Request, env: Env, deliverableId: string, ownerId: string | null,
): Promise<boolean> {
  const user = await getSessionUser(request, env);
  if (!user) return false;
  const identity = await getVisibilityScope(env, user);
  if (ownerId && identity.userIds.includes(ownerId)) return true;
  return canAccess(env, identity, 'file', deliverableId, 'view');
}

function json(body: unknown, status: number, origin: string | null): Response {
  const payload =
    status < 400 && body !== null && typeof body === 'object' && !('success' in (body as object))
      ? { success: true, ...(body as object) }
      : body;
  return jsonWithApiErrors(payload, status, corsHeaders(origin) as HeadersInit);
}
