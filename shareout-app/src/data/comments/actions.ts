import { successResponse, errorResponse, verifyOwner, type DataContext } from '../middleware';
import { dispatchCommentNotify, dispatchActionItemResolved } from '../comment-notify';
import type { Comment, CommentRow } from './types';
import { rowToComment } from './mapping';
import { checkIsAuthor, getSession } from './auth';
import { resolveAssignee } from './people';
import { broadcastEvent } from './broadcast';

/** PATCH `/:id/resolve` — mark an action item resolved or reopen it. */
export async function resolveComment(
  request: Request,
  ctx: DataContext,
  commentId: string,
): Promise<Response> {
  if (request.method !== 'PATCH') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  let body: { resolved?: boolean };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  const existing = await ctx.env.DB.prepare(
    'SELECT * FROM artifact_comments WHERE artifact_id = ? AND id = ?'
  ).bind(ctx.artifactId, commentId).first<CommentRow>();

  if (!existing) {
    return errorResponse({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found', status: 404 });
  }

  const session = await getSession(request, ctx);
  const isOwner = await verifyOwner(request, ctx);
  const isAuthor = await checkIsAuthor(request, ctx, existing.author_id);
  const isAssignee = !!session && (
    (!!existing.assignee_user_id && session.userId === existing.assignee_user_id) ||
    (!!existing.assignee_email && session.email.toLowerCase() === existing.assignee_email.toLowerCase())
  );

  if (!isOwner && !isAuthor && !isAssignee) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only author, owner, or assignee can resolve', status: 403 });
  }

  const resolved = body.resolved !== false;
  const now = new Date().toISOString();
  const resolvedBy = resolved ? (session?.email ?? session?.userId ?? null) : null;
  const resolvedAt = resolved ? now : null;

  await ctx.env.DB.prepare(
    'UPDATE artifact_comments SET resolved = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?'
  ).bind(resolved ? 1 : 0, resolvedBy, resolvedAt, now, commentId).run();

  const comment: Comment = {
    ...rowToComment(existing),
    resolved,
    resolvedBy,
    resolvedAt,
    updatedAt: now,
  };

  await broadcastEvent(ctx, { type: 'comment:resolved', comment });

  if (resolved && comment.assigneeEmail && existing.author_id !== (session?.userId ?? null)) {
    const requester = await ctx.env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
      .bind(existing.author_id).first<{ id: string; email: string }>();
    if (requester?.email) {
      dispatchActionItemResolved(
        ctx,
        { userId: requester.id, email: requester.email },
        session?.name || session?.email || 'Someone',
        comment.content,
      );
    }
  }

  return successResponse(comment);
}

/** PATCH `/:id/assign` — set or clear assignee and due date on an action item. */
export async function assignComment(
  request: Request,
  ctx: DataContext,
  commentId: string,
): Promise<Response> {
  if (request.method !== 'PATCH') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  let body: { assignee?: string | null; dueAt?: string | null };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  const session = await getSession(request, ctx);
  if (!session) {
    return errorResponse({ code: 'AUTH_REQUIRED', message: 'Sign in to assign', status: 401 });
  }

  const existing = await ctx.env.DB.prepare(
    'SELECT * FROM artifact_comments WHERE artifact_id = ? AND id = ?'
  ).bind(ctx.artifactId, commentId).first<CommentRow>();

  if (!existing) {
    return errorResponse({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found', status: 404 });
  }

  const isOwner = await verifyOwner(request, ctx);
  const isAuthor = await checkIsAuthor(request, ctx, existing.author_id);
  const isAssignee =
    (!!existing.assignee_user_id && session.userId === existing.assignee_user_id) ||
    (!!existing.assignee_email && session.email.toLowerCase() === existing.assignee_email.toLowerCase());

  if (!isOwner && !isAuthor && !isAssignee) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only author, owner, or assignee can assign', status: 403 });
  }

  let assigneeUserId: string | null = null;
  let assigneeEmail: string | null = null;
  const clearing = body.assignee == null || (typeof body.assignee === 'string' && body.assignee.trim() === '');
  if (!clearing) {
    const resolved = await resolveAssignee(ctx, body.assignee as string);
    if (!resolved) {
      return errorResponse({ code: 'ASSIGNEE_NOT_FOUND', message: 'Assignee is not on this artifact', status: 400 });
    }
    assigneeEmail = resolved.email;
    assigneeUserId = resolved.userId;
  }

  let dueAt: string | null = clearing ? null : (existing.due_at ?? null);
  if (body.dueAt !== undefined) {
    if (body.dueAt === null) {
      dueAt = null;
    } else if (typeof body.dueAt !== 'string' || Number.isNaN(Date.parse(body.dueAt))) {
      return errorResponse({ code: 'INVALID_REQUEST', message: 'dueAt must be a valid date', status: 400 });
    } else {
      dueAt = body.dueAt;
    }
  }

  const now = new Date().toISOString();
  await ctx.env.DB.prepare(
    'UPDATE artifact_comments SET assignee_user_id = ?, assignee_email = ?, due_at = ?, updated_at = ? WHERE id = ?'
  ).bind(assigneeUserId, assigneeEmail, dueAt, now, commentId).run();

  const comment: Comment = {
    ...rowToComment(existing),
    assigneeUserId,
    assigneeEmail,
    dueAt,
    updatedAt: now,
  };

  await broadcastEvent(ctx, { type: 'comment:updated', comment });

  const changed = assigneeEmail && assigneeEmail.toLowerCase() !== (existing.assignee_email ?? '').toLowerCase();
  if (changed && assigneeEmail!.toLowerCase() !== session.email.toLowerCase()) {
    dispatchCommentNotify(ctx, {
      id: comment.id,
      parentId: comment.parentId,
      authorId: session.userId,
      authorName: session.name || session.email,
      content: comment.content,
      mentions: [],
      assigneeEmail,
      dueAt,
    });
  }

  return successResponse(comment);
}
