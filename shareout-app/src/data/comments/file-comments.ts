// File comments (work/042 P2). A File's comment thread is stored as comments on the
// File's asset-bucket artifact with contextId `file:<dlv>`. Because the bucket artifact is
// a single shared object, the normal identityMode-only comment auth is NOT enough here —
// an un-scoped read would return every File's thread, and posting must respect per-file
// access. So on a bucket artifact, comment reads/writes route through this file-aware gate
// instead of identityMode. Normal (non-bucket) artifacts never enter this path, so their
// comment semantics are untouched.
import type { Env } from '../../types';
import type { DataContext } from '../middleware';
import { errorResponse } from '../middleware';
import { getSession } from './auth';
import { getVisibilityScope, type VisibilityScope } from '../../account-links';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { canAccess, type Capability } from '../../access/can-access';

/** Is this comments request targeting an asset-bucket artifact? Memoized per request. */
export async function isAssetBucketArtifact(ctx: DataContext): Promise<boolean> {
  const c = ctx as DataContext & { __isAssetBucket?: boolean };
  if (c.__isAssetBucket === undefined) {
    const row = await ctx.env.DB.prepare('SELECT 1 AS x FROM asset_buckets WHERE artifact_id = ?')
      .bind(ctx.artifactId).first<{ x: number }>();
    c.__isAssetBucket = !!row;
  }
  return c.__isAssetBucket;
}

/** True when `artifactId` is registered as an asset bucket (no request context). */
export async function isAssetBucketArtifactId(env: Env, artifactId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS x FROM asset_buckets WHERE artifact_id = ?')
    .bind(artifactId).first<{ x: number }>();
  return !!row;
}

/**
 * Whether a signed-in user may act on a file-scoped comment context.
 * Same rules as authorizeFileComment, without HTTP Response wrapping.
 */
export async function userCanAccessFileComment(
  env: Env,
  user: { id: string; email: string },
  bucketArtifactId: string,
  contextId: string | null,
  capability: Capability,
  visArg?: VisibilityScope,
): Promise<boolean> {
  const dlv = contextId && contextId.startsWith('file:') ? contextId.slice('file:'.length) : null;
  if (!dlv) return false;

  const file = await env.DB.prepare(
    'SELECT owner_id, visibility, bucket_artifact_id, workspace_id FROM asset_deliverables WHERE id = ? AND deleted_at IS NULL',
  ).bind(dlv).first<{ owner_id: string | null; visibility: string; bucket_artifact_id: string; workspace_id: string | null }>();
  if (!file || file.bucket_artifact_id !== bucketArtifactId) return false;

  const identity = visArg ?? await getVisibilityScope(env, { id: user.id, email: user.email });
  if (file.owner_id && identity.userIds.includes(file.owner_id)) return true;
  if (file.workspace_id) {
    const roles = await Promise.all(
      identity.userIds.map((uid) => getInternalWorkspaceRole(env, file.workspace_id!, uid)),
    );
    if (roles.some((r) => !!r) && file.visibility !== 'private') return true;
  }
  return canAccess(env, identity, 'file', dlv, capability);
}

// Authorize a file-scoped comment action on a bucket. Returns an error Response to send, or
// null to allow. `capability` is 'view' for reads, 'comment' for posting.
//
// Allowed iff:
//   memberVisible — a workspace member, AND the file is workspace-visible OR they own it
//                   (mirrors the lens list filter; members are intentionally NOT resolved
//                   through canAccess for files — that would leak a peer's private file), OR
//   canAccess('file', dlv, capability) — a sharee/external with a direct or folder grant.
export async function authorizeFileComment(
  request: Request,
  ctx: DataContext,
  contextId: string | null,
  capability: Capability,
): Promise<Response | null> {
  // On a bucket, every comment MUST be file-scoped — a bare context would expose every thread.
  const dlv = contextId && contextId.startsWith('file:') ? contextId.slice('file:'.length) : null;
  if (!dlv) {
    return errorResponse({ code: 'FILE_CONTEXT_REQUIRED', message: 'File comments require a file context.', status: 400 });
  }

  const file = await ctx.env.DB.prepare(
    'SELECT owner_id, visibility, bucket_artifact_id, workspace_id FROM asset_deliverables WHERE id = ? AND deleted_at IS NULL',
  ).bind(dlv).first<{ owner_id: string | null; visibility: string; bucket_artifact_id: string; workspace_id: string | null }>();
  // Cross-bucket forgery guard: the file must live in THIS bucket.
  if (!file || file.bucket_artifact_id !== ctx.artifactId) {
    return errorResponse({ code: 'FILE_NOT_FOUND', message: 'File not found in this bucket.', status: 404 });
  }

  const session = await getSession(request, ctx);
  if (session) {
    const ok = await userCanAccessFileComment(
      ctx.env,
      { id: session.userId, email: session.email },
      ctx.artifactId,
      contextId,
      capability,
    );
    if (ok) return null;
  }
  return errorResponse({ code: 'FORBIDDEN', message: 'You do not have access to this file.', status: 403 });
}

// Gate a comment sub-action (react/resolve/assign/edit/delete) by comment id on a bucket.
// Resolves the comment's file context, then defers to authorizeFileComment. An unknown id
// returns null so the handler emits its own 404 (the gate must not confirm a comment's existence).
export async function authorizeFileCommentById(
  request: Request,
  ctx: DataContext,
  commentId: string,
  capability: Capability,
): Promise<Response | null> {
  const row = await ctx.env.DB.prepare(
    'SELECT context_id FROM artifact_comments WHERE artifact_id = ? AND id = ?',
  ).bind(ctx.artifactId, commentId).first<{ context_id: string | null }>();
  if (!row) return null;
  return authorizeFileComment(request, ctx, row.context_id, capability);
}
