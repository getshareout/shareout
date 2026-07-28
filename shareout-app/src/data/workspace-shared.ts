import { generateId } from '../crypto-utils';
import { DATA_ERRORS } from '../types';
import { successResponse, errorResponse, verifyOwner, type DataContext } from './middleware';
import { createMiniDb } from './minidb-client';
import { handleTables } from './tables';

// Workspace shared tables (ADR 28 + 0067). A table stays owned by, and stored in,
// the originating artifact's mini-store. This tier exposes tables that the owner has
// opted into sharing with the workspace, resolved by the workspace-unique shared name.
//
//   /v1/data/{callerArtifactId}/workspace/tables/{sharedName}/...  → proxy to owner table
//   /v1/data/{callerArtifactId}/workspace/_shares                  → list shares (this artifact + workspace)
//   /v1/data/{callerArtifactId}/workspace/_share                   → POST: create/update a share (owner only)
//   /v1/data/{callerArtifactId}/workspace/_share/{sharedName}      → DELETE: stop sharing (owner only)
//
// The caller artifact's id stays the auth/identity anchor (dataMiddleware already
// authorized it); the grant decides whether THIS caller may read/write the data.

const SHARED_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

interface SharedTableGrant {
  id: string;
  workspace_id: string;
  shared_name: string;
  owner_artifact_id: string;
  source_table_name: string;
  access: 'read' | 'readwrite';
}

export async function handleWorkspaceData(
  request: Request,
  ctx: DataContext,
  path: string
): Promise<Response> {
  // Sharing is a workspace feature: an artifact with no workspace can't participate.
  if (!ctx.workspaceId) {
    return errorResponse({
      ...DATA_ERRORS.FORBIDDEN,
      message: 'Workspace data requires the artifact to belong to a workspace.',
      hint: 'Personal artifacts (no workspace) cannot share or read shared tables.',
    }, ctx.origin);
  }

  const parts = path.split('/').filter(Boolean);
  const [head, ...rest] = parts;

  if (head === '_shares') {
    return listShares(ctx);
  }

  if (head === '_share') {
    if (request.method === 'POST') return createShare(request, ctx);
    if (request.method === 'DELETE') return deleteShare(ctx, rest[0]);
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Use POST to share, DELETE to unshare.' }, ctx.origin);
  }

  if (head === 'tables') {
    return proxySharedTable(request, ctx, rest);
  }

  return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
}

// ── Read/write proxy ─────────────────────────────────────────────────────────

async function proxySharedTable(
  request: Request,
  ctx: DataContext,
  rest: string[]
): Promise<Response> {
  const [sharedName, ...tail] = rest;
  if (!sharedName) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Shared table name required.' }, ctx.origin);
  }

  const grant = await ctx.env.DB.prepare(
    `SELECT id, workspace_id, shared_name, owner_artifact_id, source_table_name, access
       FROM workspace_shared_tables WHERE workspace_id = ? AND shared_name = ?`
  ).bind(ctx.workspaceId, sharedName).first<SharedTableGrant>();

  if (!grant) {
    return errorResponse({
      ...DATA_ERRORS.NOT_FOUND,
      message: `No shared table "${sharedName}" in this workspace.`,
      hint: 'The owning artifact must share it first (workspace._share), or check the name.',
    }, ctx.origin);
  }

  if (isWriteOp(request.method, tail) && grant.access !== 'readwrite') {
    return errorResponse({
      ...DATA_ERRORS.FORBIDDEN,
      message: `Shared table "${sharedName}" is read-only.`,
      hint: 'The owner shared it with read access only.',
    }, ctx.origin);
  }

  // Re-point the request at the owner artifact's mini-store, keeping the caller's
  // origin/auth context. The shared name is rewritten to the owner's real table name.
  // viewerScope is cleared: shared tables are exposed to the whole workspace as a
  // unit, not row-filtered per viewer (v1 — see PR notes).
  const ownerCtx: DataContext = {
    ...ctx,
    artifactId: grant.owner_artifact_id,
    db: createMiniDb(ctx.env, grant.owner_artifact_id, ctx.workspaceId),
    viewerScope: null,
  };

  const ownerPath = '/' + [grant.source_table_name, ...tail].join('/');
  return handleTables(request, ownerCtx, ownerPath);
}

// query/count/distinct are POST actions that only read; export is a GET. Everything
// else with a mutating method (insert/update/delete) is a write. `tail` is the path
// after the shared name, so tail[0] is the rowId-or-action segment.
function isWriteOp(method: string, tail: string[]): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'OPTIONS') return false;
  const action = tail[0];
  if (m === 'POST' && (action === 'query' || action === 'count' || action === 'distinct')) return false;
  return true;
}

// ── Share management (owner only) ────────────────────────────────────────────

async function createShare(request: Request, ctx: DataContext): Promise<Response> {
  if (!(await verifyOwner(request, ctx))) {
    return errorResponse({
      ...DATA_ERRORS.FORBIDDEN,
      message: 'Only the artifact owner can share its tables.',
    }, ctx.origin);
  }

  let body: { table?: string; as?: string; access?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }

  const sourceTable = body.table?.trim();
  const sharedName = (body.as?.trim() || sourceTable || '');
  const access = body.access === 'readwrite' ? 'readwrite' : 'read';

  if (!sourceTable || !SHARED_NAME_PATTERN.test(sourceTable)) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'A valid "table" name is required.' }, ctx.origin);
  }
  if (!SHARED_NAME_PATTERN.test(sharedName)) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: `Invalid shared name "${sharedName}".` }, ctx.origin);
  }

  // Enforce per-workspace uniqueness of the shared name, but let the SAME owner
  // re-share (update access / source) under a name it already owns.
  const existing = await ctx.env.DB.prepare(
    'SELECT owner_artifact_id FROM workspace_shared_tables WHERE workspace_id = ? AND shared_name = ?'
  ).bind(ctx.workspaceId, sharedName).first<{ owner_artifact_id: string }>();

  if (existing && existing.owner_artifact_id !== ctx.artifactId) {
    return errorResponse({
      ...DATA_ERRORS.CONFLICT,
      message: `"${sharedName}" is already shared by another artifact in this workspace.`,
      hint: 'Pick a different "as" name.',
    }, ctx.origin);
  }

  if (existing) {
    await ctx.env.DB.prepare(
      `UPDATE workspace_shared_tables SET source_table_name = ?, access = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE workspace_id = ? AND shared_name = ?`
    ).bind(sourceTable, access, ctx.workspaceId, sharedName).run();
  } else {
    await ctx.env.DB.prepare(
      `INSERT INTO workspace_shared_tables
         (id, workspace_id, shared_name, owner_artifact_id, source_table_name, access)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(generateId('wst'), ctx.workspaceId, sharedName, ctx.artifactId, sourceTable, access).run();
  }

  return successResponse({ sharedName, table: sourceTable, access }, existing ? 200 : 201, ctx.origin);
}

async function deleteShare(ctx: DataContext, sharedName: string | undefined): Promise<Response> {
  if (!sharedName) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Shared name required.' }, ctx.origin);
  }
  // Only the owning artifact may unshare its own grant.
  const grant = await ctx.env.DB.prepare(
    'SELECT owner_artifact_id FROM workspace_shared_tables WHERE workspace_id = ? AND shared_name = ?'
  ).bind(ctx.workspaceId, sharedName).first<{ owner_artifact_id: string }>();

  if (!grant) return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
  if (grant.owner_artifact_id !== ctx.artifactId) {
    return errorResponse({ ...DATA_ERRORS.FORBIDDEN, message: 'Only the owning artifact can unshare this table.' }, ctx.origin);
  }

  await ctx.env.DB.prepare(
    'DELETE FROM workspace_shared_tables WHERE workspace_id = ? AND shared_name = ?'
  ).bind(ctx.workspaceId, sharedName).run();

  return successResponse({ unshared: true, sharedName }, 200, ctx.origin);
}

async function listShares(ctx: DataContext): Promise<Response> {
  const { results } = await ctx.env.DB.prepare(
    `SELECT shared_name, owner_artifact_id, source_table_name, access
       FROM workspace_shared_tables WHERE workspace_id = ? ORDER BY shared_name`
  ).bind(ctx.workspaceId).all<{
    shared_name: string; owner_artifact_id: string; source_table_name: string; access: string;
  }>();

  const shares = (results ?? []).map((r) => ({
    sharedName: r.shared_name,
    access: r.access,
    ownerArtifactId: r.owner_artifact_id,
    sourceTable: r.source_table_name,
    ownedByCaller: r.owner_artifact_id === ctx.artifactId,
  }));

  return successResponse({ shares }, 200, ctx.origin);
}
