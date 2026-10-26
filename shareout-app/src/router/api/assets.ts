/**
 * Asset library + Deliverables API — a membership-authorized wrapper over the
 * per-artifact blob pipeline, targeting a hidden per-scope asset bucket
 * (assets/bucket.ts). Files are grouped into versioned deliverables (029) and
 * bundled into collections shared via public download links.
 *
 *   GET    /v1/assets                              list deliverables (+ loose files)
 *   POST   /v1/assets/upload                       request an upload
 *   PUT    /v1/assets/_upload/{token}              receive bytes (member-authorized)
 *   DELETE /v1/assets/{blobId}                     delete a loose blob
 *   POST   /v1/assets/deliverables                 { blobId, name, visibility? } → new deliverable (v1)
 *   POST   /v1/assets/deliverables/{id}/version    { blobId } → add a version
 *   GET    /v1/assets/deliverables/{id}/versions   version history
 *   PATCH  /v1/assets/deliverables/{id}            { visibility?, folderId? } → set file props
 *
 * File visibility: 'team' (internal workspace members; the workspace default),
 * 'private' (owner + direct grants), 'workspace' (anyone with the link).
 *   DELETE /v1/assets/deliverables/{id}            delete deliverable + its versions
 *   POST   /v1/assets/collections                  { name, deliverableIds[] } → collection
 *   POST   /v1/assets/collections/{id}/share       { expiresAt? } → { url }
 *   POST   /v1/assets/collections/{id}/send        { to, expiresAt? } → email the link
 *   ...same under /v1/workspaces/{ws}/assets (any member; deleting another member's file needs owner/admin).
 *   POST   /v1/workspaces/{ws}/assets/to-artifacts  { dryRun?, limit?, retry? } → Files become artifacts (owner/admin)
 */
import type { FetchContext } from '../context';
import type { Env } from '../../types';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { handleBlobs, handleBlobUpload } from '../../data/blobs/handler';
import { getOrCreateAssetBucket, buildAssetBucketContext, type AssetBucketRow } from '../../assets/bucket';
import { enrichDeliverable } from '../../assets/enrich';
import { listFileUsage } from '../../assets/usage';
import { filesToArtifacts, planFilesToArtifacts } from '../../assets/to-artifacts';
import { queueKnowledgeSource } from '../../knowledge/corpus/ingest';
import {
  collectionInBucket,
  createDeliverable, addDeliverableVersion, listDeliverables, listDeliverableVersions, setDeliverableFields,
  createCollection, createShareLink, listShareLinks, revokeShareLink, hashAssetLinkPassword, type LinkGate,
} from '../../assets/deliverables';

/** Build the stored gate value from a share request body. Returns an error string
 *  when the chosen gate is missing its input. */
async function resolveGate(b: { gate?: string; password?: string; domains?: string[] }): Promise<{ gate: LinkGate; gateValue: string | null } | { error: string }> {
  const gate: LinkGate = b.gate === 'password' || b.gate === 'domain' ? b.gate : 'none';
  if (gate === 'password') {
    if (!b.password) return { error: 'password required for a password gate' };
    return { gate, gateValue: await hashAssetLinkPassword(b.password) };
  }
  if (gate === 'domain') {
    const domains = (Array.isArray(b.domains) ? b.domains : []).map((d) => String(d).trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    if (!domains.length) return { error: 'domains required for a domain gate' };
    return { gate, gateValue: domains.join(',') };
  }
  return { gate: 'none', gateValue: null };
}
import { dispatchLifecycleEmail } from '../../email/gateway';
import { writeBlobOrigin } from '../../serve/share-target';
import { JSON_IN, jsonList } from '../../sql-in';

const FILE_VISIBILITIES = ['team', 'private', 'workspace'];
const VISIBILITY_ERROR = 'visibility must be team, private or workspace';

export async function routeAssetApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  let workspaceId: string | null = null;
  let rest: string;
  let m = path.match(/^\/v1\/workspaces\/([^/]+)\/assets(\/.*)?$/);
  if (m) { workspaceId = m[1]; rest = m[2] || ''; }
  else {
    m = path.match(/^\/v1\/assets(\/.*)?$/);
    if (!m) return null;
    rest = m[1] || '';
  }

  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;

  // Deleting someone else's workspace file is an owner/admin action; personal scope is all yours.
  let isWsAdmin = !workspaceId;
  if (workspaceId) {
    const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
    if (!role) return addCORS(Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }));
    isWsAdmin = role === 'owner' || role === 'admin';
  }
  const forbidden = () => addCORS(Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }));

  const bucket = await getOrCreateAssetBucket(env, user.id, workspaceId);
  const sub = rest.replace(/^\//, '');
  const method = request.method;
  const json = (body: unknown, status = 200) => addCORS(Response.json(body, { status }));
  const body = async <T>() => (await request.json().catch(() => ({}))) as T;
  // Workspace Files feed the knowledge corpus; `version` keeps re-queues idempotent.
  // A private file does not exist for anyone but its owner.
  const fileRow = async (id: string) => {
    const r = await env.DB.prepare('SELECT visibility, owner_id FROM asset_deliverables WHERE id = ? AND bucket_artifact_id = ? AND deleted_at IS NULL')
      .bind(id, bucket.id).first<{ visibility: string; owner_id: string }>();
    return r && (r.visibility !== 'private' || r.owner_id === user.id) ? r : null;
  };
  const learn = (refId: string, version: string) => {
    if (workspaceId) ctx.executionCtx?.waitUntil(
      queueKnowledgeSource(env, ctx.executionCtx, { workspaceId, kind: 'asset', refId }, version).catch(() => {}),
    );
  };

  if (sub === 'to-artifacts' && method === 'POST' && workspaceId) {
    if (!isWsAdmin) return forbidden();
    const b = await body<{ dryRun?: boolean; limit?: number; retry?: boolean }>();
    return json(b.dryRun ? await planFilesToArtifacts(env, workspaceId) : await filesToArtifacts(env, workspaceId, { limit: b.limit, retry: b.retry }));
  }

  if ((rest === '' || rest === '/') && method === 'GET') {
    return addCORS(await listAssets(request, env, bucket, user.id, isWsAdmin));
  }

  // ----- deliverables -----
  if (sub === 'deliverables' && method === 'POST') {
    const b = await body<{ blobId?: string; name?: string; visibility?: string }>();
    if (!b.blobId) return json({ error: 'blobId required' }, 400);
    if (b.visibility !== undefined && !FILE_VISIBILITIES.includes(b.visibility)) return json({ error: VISIBILITY_ERROR }, 400);
    const name = (b.name || '').trim() || 'Untitled';
    // New workspace files are team-only unless the uploader opts into a public link;
    // personal-library files keep the link-shareable default (no team to scope to).
    const visibility = b.visibility || (workspaceId ? 'team' : 'workspace');
    const d = await createDeliverable(env, bucket.id, workspaceId, user.id, name, b.blobId, { visibility });
    ctx.executionCtx?.waitUntil(enrichDeliverable(env, bucket.id, d.id).catch(() => {}));
    learn(d.id, b.blobId);
    return json({ id: d.id, name, visibility }, 201);
  }
  let dm = sub.match(/^deliverables\/([^/]+)\/version$/);
  if (dm && method === 'POST') {
    const b = await body<{ blobId?: string }>();
    if (!b.blobId) return json({ error: 'blobId required' }, 400);
    if (!(await fileRow(dm[1]))) return json({ error: 'file not found' }, 404);
    const v = await addDeliverableVersion(env, bucket.id, dm[1], b.blobId);
    if (v === null) return json({ error: 'file not found' }, 404);
    ctx.executionCtx?.waitUntil(enrichDeliverable(env, bucket.id, dm[1]).catch(() => {}));
    learn(dm[1], b.blobId);
    return json({ deliverableId: dm[1], versionNo: v });
  }
  dm = sub.match(/^deliverables\/([^/]+)\/versions$/);
  if (dm && method === 'GET') {
    if (!(await fileRow(dm[1]))) return json({ error: 'file not found' }, 404);
    return json({ versions: await listDeliverableVersions(env, bucket.id, dm[1]) });
  }
  dm = sub.match(/^deliverables\/([^/]+)\/usage$/);
  if (dm && method === 'GET') {
    if (!(await fileRow(dm[1]))) return json({ error: 'file not found' }, 404);
    return json({ usage: await listFileUsage(env, dm[1]) });
  }
  dm = sub.match(/^deliverables\/([^/]+)$/);
  if (dm && method === 'PATCH') {
    const file = await fileRow(dm[1]);
    if (!file) return json({ error: 'file not found' }, 404);
    if (file.owner_id !== user.id && !isWsAdmin) return forbidden();
    const b = await body<{ visibility?: string; folderId?: string | null }>();
    const fields: { visibility?: string; folderId?: string | null } = {};
    if (b.visibility !== undefined) {
      if (!FILE_VISIBILITIES.includes(b.visibility)) return json({ error: VISIBILITY_ERROR }, 400);
      fields.visibility = b.visibility;
    }
    if (b.folderId) {
      const folder = await env.DB.prepare(
        bucket.workspace_id
          ? 'SELECT 1 AS n FROM folders WHERE id = ? AND workspace_id = ?'
          : 'SELECT 1 AS n FROM folders WHERE id = ? AND workspace_id IS NULL AND owner_id = ?',
      ).bind(b.folderId, bucket.workspace_id ?? user.id).first();
      if (!folder) return json({ error: 'folder not found' }, 400);
    }
    if (b.folderId !== undefined) fields.folderId = b.folderId || null;
    const ok = await setDeliverableFields(env, bucket.id, dm[1], fields);
    return ok ? json({ ok: true }) : json({ error: 'file not found' }, 404);
  }
  if (dm && method === 'DELETE') {
    const own = await env.DB.prepare('SELECT owner_id FROM asset_deliverables WHERE id = ? AND bucket_artifact_id = ?')
      .bind(dm[1], bucket.id).first<{ owner_id: string }>();
    if (!own) return json({ error: 'file not found' }, 404);
    if (!isWsAdmin && own.owner_id !== user.id) return forbidden();
    const res = await deleteDeliverable(request, env, bucket, dm[1]);
    if (res.ok) learn(dm[1], `deleted:${Date.now()}`);
    return addCORS(res);
  }

  // ----- collections + sharing -----
  if (sub === 'collections' && method === 'POST') {
    const b = await body<{ name?: string; deliverableIds?: string[] }>();
    const ids = Array.isArray(b.deliverableIds) ? b.deliverableIds.filter((x) => typeof x === 'string') : [];
    if (!ids.length) return json({ error: 'deliverableIds required' }, 400);
    // Only real deliverables in this bucket can be bundled — a loose-blob id silently
    // drops out of the share link's JOIN otherwise (getCollectionFiles → deliverables).
    const valid = await env.DB.prepare(
      `SELECT id FROM asset_deliverables WHERE bucket_artifact_id = ? AND deleted_at IS NULL AND (visibility != 'private' OR owner_id = ?) AND id IN ${JSON_IN}`,
    ).bind(bucket.id, user.id, jsonList(ids)).all<{ id: string }>();
    const validIds = (valid.results || []).map((r) => r.id);
    if (!validIds.length) return json({ error: 'no valid files to bundle' }, 400);
    const c = await createCollection(env, bucket.id, workspaceId, user.id, (b.name || '').trim() || 'Untitled collection', validIds);
    return json({ id: c.id, fileCount: validIds.length }, 201);
  }
  let cm = sub.match(/^collections\/([^/]+)\/(share|send)$/);
  if (cm && method === 'POST' && !(await collectionInBucket(env, bucket.id, cm[1]))) {
    return json({ error: 'collection not found' }, 404);
  }
  cm = sub.match(/^collections\/([^/]+)\/share$/);
  if (cm && method === 'POST') {
    const b = await body<{ expiresAt?: string; gate?: string; password?: string; domains?: string[] }>();
    const g = await resolveGate(b);
    if ('error' in g) return json(g, 400);
    const link = await createShareLink(env, cm[1], user.id, { expiresAt: b.expiresAt || null, gate: g.gate, gateValue: g.gateValue });
    return json(link, 201);
  }
  cm = sub.match(/^collections\/([^/]+)\/send$/);
  if (cm && method === 'POST') {
    const b = await body<{ to?: string; expiresAt?: string; gate?: string; password?: string; domains?: string[] }>();
    if (!b.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.to)) return json({ error: 'valid "to" email required' }, 400);
    const g = await resolveGate(b);
    if ('error' in g) return json(g, 400);
    const link = await createShareLink(env, cm[1], user.id, { expiresAt: b.expiresAt || null, gate: g.gate, gateValue: g.gateValue });
    const col = await env.DB.prepare('SELECT name FROM asset_collections WHERE id = ?').bind(cm[1]).first<{ name: string }>();
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM asset_collection_items WHERE collection_id = ?').bind(cm[1]).first<{ n: number }>();
    await dispatchLifecycleEmail(env, {
      type: 'asset_delivery',
      toEmail: b.to,
      workspaceId: workspaceId ?? undefined,
      data: { collectionName: col?.name || 'Files', downloadUrl: link.url, fileCount: count?.n || 0, senderName: user.email || '', expiresAt: b.expiresAt || null },
    }).catch(() => {});
    return json({ url: link.url, sent: true });
  }

  // ----- sent deliveries: list + revoke share links -----
  if (sub === 'links' && method === 'GET') {
    return json({ links: await listShareLinks(env, bucket.id) });
  }
  const lm = sub.match(/^links\/([^/]+)\/revoke$/);
  if (lm && method === 'POST') {
    const ok = await revokeShareLink(env, bucket.id, lm[1]);
    return ok ? json({ revoked: true }) : json({ error: 'link not found' }, 404);
  }

  // ----- raw blob pipeline (upload / delete) -----
  const bctx = buildAssetBucketContext(env, bucket, request.headers.get('Origin'));
  const assetsBase = workspaceId ? `/v1/workspaces/${workspaceId}/assets` : '/v1/assets';

  if (sub === 'upload' && method === 'POST') {
    const resp = await handleBlobs(request, bctx, 'upload');
    const j = await resp.json().catch(() => null) as { success?: boolean; data?: { tokenId?: string; uploadUrl?: string; direct?: boolean } } | null;
    if (j?.success && j.data?.tokenId) {
      j.data.uploadUrl = `${assetsBase}/_upload/${j.data.tokenId}`;
      j.data.direct = false;
    }
    return addCORS(Response.json(j, { status: resp.status }));
  }

  const up = sub.match(/^_upload\/(.+)$/);
  if (up && method === 'PUT') {
    return addCORS(await handleBlobUpload(request, bctx, up[1]));
  }

  const originMatch = sub.match(/^([^/]+)\/origin$/);
  if (originMatch && method === 'POST') {
    const blobId = originMatch[1];
    const b = await body<{ source?: string }>();
    if (b.source !== 'chat') return json({ error: 'source must be chat' }, 400);
    const row = await env.DB.prepare('SELECT id FROM blobs WHERE id = ? AND artifact_id = ?')
      .bind(blobId, bucket.id).first();
    if (!row) return json({ error: 'blob not found' }, 404);
    await writeBlobOrigin(env, blobId, 'chat');
    return json({ ok: true });
  }

  if (method === 'DELETE' && !isWsAdmin) return forbidden();
  const blobId = sub.split('/')[0];
  if (blobId && !['upload', 'storage'].includes(blobId)) {
    const hidden = await env.DB.prepare(
      `SELECT 1 AS n FROM blobs b JOIN asset_deliverables d ON d.id = b.deliverable_id
       WHERE b.id = ? AND b.artifact_id = ? AND d.visibility = 'private' AND d.owner_id != ?`,
    ).bind(blobId, bucket.id, user.id).first();
    if (hidden) return json({ error: 'blob not found' }, 404);
  }
  return addCORS(await handleBlobs(request, bctx, sub));
}

/** Delete a deliverable: remove every version blob (R2 + storage) then the row. */
async function deleteDeliverable(request: Request, env: Env, bucket: AssetBucketRow, deliverableId: string): Promise<Response> {
  const bctx = buildAssetBucketContext(env, bucket, request.headers.get('Origin'));
  const blobs = await env.DB.prepare('SELECT id FROM blobs WHERE deliverable_id = ? AND artifact_id = ?')
    .bind(deliverableId, bucket.id).all<{ id: string }>();
  for (const b of blobs.results || []) {
    await handleBlobs(new Request(request.url, { method: 'DELETE' }), bctx, b.id).catch(() => {});
  }
  await env.DB.prepare('DELETE FROM asset_collection_items WHERE deliverable_id = ?').bind(deliverableId).run();
  await env.DB.prepare('DELETE FROM asset_deliverables WHERE id = ? AND bucket_artifact_id = ?').bind(deliverableId, bucket.id).run();
  return Response.json({ success: true });
}

async function listAssets(request: Request, env: Env, bucket: AssetBucketRow, viewerId: string, isWsAdmin: boolean): Promise<Response> {
  const url = new URL(request.url);
  const base = `${url.protocol}//${url.host}/v1/data/${bucket.id}/blobs`;
  const fileBase = `${url.protocol}//${url.host}/v1/files`;

  // Private files are visible only to their owner; workspace files to any member (auth is
  // already enforced upstream by bucket membership). Mirrors artifacts' homeScopeSql.
  const deliverables = (await listDeliverables(env, bucket.id))
    .filter((d) => d.visibility !== 'private' || d.ownerId === viewerId);

  // Loose blobs (no deliverable) — pre-029 uploads; shown alongside.
  const loose = await env.DB.prepare(
    `SELECT id, filename, mime_type, size_bytes, created_at FROM blobs
       WHERE artifact_id = ? AND deliverable_id IS NULL ORDER BY created_at DESC LIMIT 1000`,
  ).bind(bucket.id).all<{ id: string; filename: string; mime_type: string; size_bytes: number; created_at: string }>();

  const storage = await env.DB.prepare(
    'SELECT used_bytes, blob_count FROM artifact_storage WHERE artifact_id = ?',
  ).bind(bucket.id).first<{ used_bytes: number; blob_count: number }>();

  return Response.json({
    bucketId: bucket.id,
    deliverables: deliverables.map((d) => ({
      id: d.id, name: d.name, visibility: d.visibility, folderId: d.folderId,
      versionCount: d.versionCount, latestVersion: d.latestVersion,
      blobId: d.blobId, filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
      // Deliverable-keyed, identity-checked route (work/042 P3); ?v busts the client cache
      // on a new version. Private files serve ONLY here, never via the raw blob route.
      url: `${fileBase}/${d.id}/content?v=${d.latestVersion}`,
      enrichment: d.enrichment,
      usageCount: d.usageCount,
      usedIn: d.usedIn,
      ownerName: d.ownerName,
      updatedAt: d.updatedAt,
      canDelete: isWsAdmin || d.ownerId === viewerId,
    })),
    loose: (loose.results || []).map((b) => ({
      id: b.id, filename: b.filename, mimeType: b.mime_type, sizeBytes: b.size_bytes,
      url: `${base}/${b.id}/content`,
      updatedAt: b.created_at,
      canDelete: isWsAdmin,
    })),
    usedBytes: storage?.used_bytes || 0,
    count: storage?.blob_count || 0,
  });
}
