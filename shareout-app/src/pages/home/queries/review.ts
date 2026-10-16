/**
 * Inspector review actions: resolve/reopen, assign, approve a version.
 * All need comment access on the artifact (see canReviewArtifact); on asset-bucket
 * artifacts the file gate for the comment's own file decides instead.
 */
import type { Env } from '../../../types';
import { getVisibilityScope, type VisibilityScope } from '../../../account-links';
import { notifyCommentTargets, notifyActionItemResolved } from '../../../data/comment-notify';
import { broadcastEvent } from '../../../data/comments/broadcast';
import { isAssetBucketArtifactId, userCanAccessFileComment } from '../../../data/comments/file-comments';
import { canReviewArtifact } from '../../../data/comments/review-access';
import { resolveAssignee } from '../../../data/comments/people';
import { rowToComment } from '../../../data/comments/mapping';
import type { CommentRow } from '../../../data/comments/types';
import type { DataContext } from '../../../data/middleware';
import { generateId } from '../../../crypto-utils';
import { userCanAccessArtifact } from './comments';

type User = { id: string; email: string | null; name?: string | null };
export type ReviewResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

const deny = (status: number, code: string, message: string) => ({ ok: false as const, status, code, message });

interface ArtRow { id: string; owner_id: string | null; workspace_id: string | null }

async function artifactRow(env: Env, artifactId: string): Promise<ArtRow | null> {
  return env.DB.prepare('SELECT id, owner_id, workspace_id FROM artifacts WHERE id = ? AND deleted_at IS NULL')
    .bind(artifactId).first<ArtRow>();
}

function pseudoCtx(env: Env, art: ArtRow): DataContext {
  return { env, artifactId: art.id, workspaceId: art.workspace_id ?? '', artifact: { id: art.id, owner_id: art.owner_id, workspace_id: art.workspace_id } } as unknown as DataContext;
}

async function mayReview(env: Env, user: User, artifactId: string, contextId: string | null, vis: VisibilityScope): Promise<boolean> {
  if (await isAssetBucketArtifactId(env, artifactId)) {
    if (!user.email) return false;
    return userCanAccessFileComment(env, { id: user.id, email: user.email }, artifactId, contextId, 'comment', vis);
  }
  return canReviewArtifact(env, artifactId, user, vis);
}

/** Load a comment that must belong to `artifactId`, then apply the review gate. */
async function gatedComment(env: Env, user: User, artifactId: string, commentId: string, vis: VisibilityScope)
  : Promise<ReviewResult<{ art: ArtRow; row: CommentRow }>> {
  const [art, row] = await Promise.all([
    artifactRow(env, artifactId),
    env.DB.prepare('SELECT * FROM artifact_comments WHERE artifact_id = ? AND id = ?').bind(artifactId, commentId).first<CommentRow>(),
  ]);
  if (!art || !row) return deny(404, 'COMMENT_NOT_FOUND', 'Comment not found');
  if (!(await mayReview(env, user, artifactId, row.context_id, vis))) return deny(403, 'FORBIDDEN', 'You need comment access to do that');
  return { ok: true, data: { art, row } };
}

export async function setCommentResolved(env: Env, user: User, artifactId: string, commentId: string, resolved: boolean, visArg?: VisibilityScope)
  : Promise<ReviewResult<{ id: string; resolved: number; resolved_by: string | null; resolved_at: string | null }>> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const g = await gatedComment(env, user, artifactId, commentId, vis);
  if (!g.ok) return g;
  const { art, row } = g.data;
  const now = new Date().toISOString();
  const by = resolved ? (user.email ?? user.id) : null;
  const at = resolved ? now : null;
  await env.DB.prepare('UPDATE artifact_comments SET resolved = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
    .bind(resolved ? 1 : 0, by, at, now, commentId).run();
  const ctx = pseudoCtx(env, art);
  const comment = { ...rowToComment(row), resolved, resolvedBy: by, resolvedAt: at, updatedAt: now };
  try { await broadcastEvent(ctx, { type: 'comment:resolved', comment }); } catch { /* best-effort */ }
  if (resolved && row.assignee_email && row.author_id && row.author_id !== user.id) {
    const requester = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(row.author_id).first<{ id: string; email: string }>();
    if (requester?.email) {
      try { await notifyActionItemResolved(ctx, { userId: requester.id, email: requester.email }, user.name || user.email || 'Someone', row.content); } catch { /* best-effort */ }
    }
  }
  return { ok: true, data: { id: commentId, resolved: resolved ? 1 : 0, resolved_by: by, resolved_at: at } };
}

export async function setCommentAssignee(env: Env, user: User, artifactId: string, commentId: string, assignee: string | null, visArg?: VisibilityScope)
  : Promise<ReviewResult<{ id: string; assignee_email: string | null }>> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const g = await gatedComment(env, user, artifactId, commentId, vis);
  if (!g.ok) return g;
  const { art, row } = g.data;
  if (row.parent_id) return deny(400, 'INVALID_REQUEST', 'Only a thread can be assigned, not a reply');
  const ctx = pseudoCtx(env, art);
  let email: string | null = null;
  let userId: string | null = null;
  if (assignee && assignee.trim()) {
    const found = await resolveAssignee(ctx, assignee);
    if (!found) return deny(400, 'ASSIGNEE_NOT_FOUND', 'Assignee is not on this artifact');
    email = found.email; userId = found.userId;
  }
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE artifact_comments SET assignee_user_id = ?, assignee_email = ?, due_at = ?, updated_at = ? WHERE id = ?')
    .bind(userId, email, email ? (row.due_at ?? null) : null, now, commentId).run();
  const comment = { ...rowToComment(row), assigneeUserId: userId, assigneeEmail: email, updatedAt: now };
  try { await broadcastEvent(ctx, { type: 'comment:updated', comment }); } catch { /* best-effort */ }
  const changed = email && email.toLowerCase() !== (row.assignee_email ?? '').toLowerCase();
  if (changed && email!.toLowerCase() !== (user.email ?? '').toLowerCase()) {
    try {
      await notifyCommentTargets(ctx, {
        id: commentId, parentId: null, authorId: user.id, authorName: user.name || user.email || 'Someone',
        content: row.content, mentions: [], assigneeEmail: email, dueAt: row.due_at ?? null,
      });
    } catch { /* best-effort */ }
  }
  return { ok: true, data: { id: commentId, assignee_email: email } };
}

export interface ApprovalRow {
  version_id: string; version_no: number; user_id: string;
  name: string | null; email: string | null; created_at: string;
}

export async function listApprovals(env: Env, artifactId: string): Promise<ApprovalRow[]> {
  const rows = await env.DB.prepare(`
    SELECT ap.version_id, v.version_no, ap.user_id, u.name, u.email, ap.created_at
    FROM artifact_approvals ap
    JOIN versions v ON v.id = ap.version_id
    LEFT JOIN users u ON u.id = ap.user_id
    WHERE ap.artifact_id = ?
    ORDER BY v.version_no DESC, ap.created_at ASC
    LIMIT 200
  `).bind(artifactId).all<ApprovalRow>();
  return rows.results || [];
}

export interface ReviewState {
  live_version_id: string | null;
  live_version_no: number | null;
  can_review: boolean;
  approvals: ApprovalRow[];
  /** Version ids the caller (any linked account) has approved. */
  my_approvals: string[];
}

/** Live version, whether the caller may review, and every approval. Null = no view access. */
export async function queryReviewState(env: Env, user: User, artifactId: string, visArg?: VisibilityScope): Promise<ReviewState | null> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const [canView, canReview, live, approvals] = await Promise.all([
    userCanAccessArtifact(env, vis, artifactId, user),
    canReviewArtifact(env, artifactId, user, vis),
    env.DB.prepare(`SELECT v.id, v.version_no FROM deployments d JOIN versions v ON v.id = d.version_id
      WHERE d.artifact_id = ? AND d.channel = 'production'`).bind(artifactId).first<{ id: string; version_no: number }>(),
    listApprovals(env, artifactId),
  ]);
  if (!canView) return null;
  const my = approvals.filter((a) => vis.userIds.includes(a.user_id)).map((a) => a.version_id);
  return { live_version_id: live?.id ?? null, live_version_no: live?.version_no ?? null, can_review: canReview, approvals, my_approvals: my };
}

/** Approve (or withdraw approval of) a version — the live one unless `versionId` is given. */
export async function setApproval(env: Env, user: User, artifactId: string, versionId: string | null, approved: boolean, visArg?: VisibilityScope)
  : Promise<ReviewResult<ReviewState>> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  if (!(await artifactRow(env, artifactId))) return deny(404, 'NOT_FOUND', 'Artifact not found');
  if (!(await canReviewArtifact(env, artifactId, user, vis))) return deny(403, 'FORBIDDEN', 'You need comment access to approve');
  const version = versionId
    ? await env.DB.prepare('SELECT id FROM versions WHERE id = ? AND artifact_id = ?').bind(versionId, artifactId).first<{ id: string }>()
    : await env.DB.prepare("SELECT version_id AS id FROM deployments WHERE artifact_id = ? AND channel = 'production'").bind(artifactId).first<{ id: string }>();
  if (!version?.id) return deny(404, 'VERSION_NOT_FOUND', 'Version not found');
  if (approved) {
    await env.DB.prepare('INSERT OR IGNORE INTO artifact_approvals (id, artifact_id, version_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(generateId('apv'), artifactId, version.id, user.id, new Date().toISOString()).run();
  } else {
    await env.DB.prepare('DELETE FROM artifact_approvals WHERE artifact_id = ? AND version_id = ? AND user_id = ?')
      .bind(artifactId, version.id, user.id).run();
  }
  const state = await queryReviewState(env, user, artifactId, vis);
  return state ? { ok: true, data: state } : deny(403, 'FORBIDDEN', 'No access');
}
