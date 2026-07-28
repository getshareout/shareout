import { generateId } from '../../crypto-utils';
import { successResponse, errorResponse, verifyOwner, type DataContext } from '../middleware';
import { emitJobEvent } from '../../scheduling/events';
import { dispatchCommentNotify } from '../comment-notify';
import { MAX_CONTENT_LENGTH, type Comment, type CommentRow, type CommentsConfig } from './types';
import { rowToComment, getCommentDepth } from './mapping';
import { validateIdentity, checkIsAuthor, getSession } from './auth';
import { resolveAssignee } from './people';
import { attachReactions } from './reactions';
import { broadcastEvent } from './broadcast';
import { isAssetBucketArtifact, authorizeFileComment } from './file-comments';

/** GET `/` — list comments with optional filters. */
export async function listComments(request: Request, ctx: DataContext): Promise<Response> {
  const url = new URL(request.url);
  const contextId = url.searchParams.get('contextId');
  const parentId = url.searchParams.get('parentId');
  const resolved = url.searchParams.get('resolved');
  const assignee = url.searchParams.get('assignee');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);
  const skip = parseInt(url.searchParams.get('skip') || '0');

  // File comments (work/042 P2): on an asset-bucket artifact, reads must be file-scoped and
  // pass the per-file access gate — the bucket's identityMode does not apply here.
  if (await isAssetBucketArtifact(ctx)) {
    const gate = await authorizeFileComment(request, ctx, contextId, 'view');
    if (gate) return gate;
  }

  let sql = 'SELECT * FROM artifact_comments WHERE artifact_id = ?';
  const params: (string | number)[] = [ctx.artifactId];

  if (contextId !== null) {
    sql += ' AND context_id = ?';
    params.push(contextId);
  }

  if (assignee !== null) {
    if (assignee === 'me') {
      const session = await getSession(request, ctx);
      if (!session) return successResponse({ comments: [], count: 0 });
      sql += ' AND (assignee_user_id = ? OR lower(assignee_email) = lower(?))';
      params.push(session.userId, session.email);
    } else {
      sql += ' AND lower(assignee_email) = lower(?)';
      params.push(assignee);
    }
  }

  if (parentId === 'null') {
    sql += ' AND parent_id IS NULL';
  } else if (parentId) {
    sql += ' AND parent_id = ?';
    params.push(parentId);
  }

  if (resolved === 'true') {
    sql += ' AND resolved = 1';
  } else if (resolved === 'false') {
    sql += ' AND resolved = 0';
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, skip);

  const result = await ctx.env.DB.prepare(sql).bind(...params).all<CommentRow>();

  const comments: Comment[] = result.results.map(rowToComment);
  await attachReactions(request, ctx, comments);

  return successResponse({ comments, count: comments.length });
}

/** POST `/` — create a comment or reply. */
export async function addComment(
  request: Request,
  ctx: DataContext,
  config: CommentsConfig,
): Promise<Response> {
  let body: {
    content: string;
    contextId?: string;
    parentId?: string;
    authorName?: string;
    position?: unknown;
    state?: unknown;
    mentions?: string[];
    assignee?: string | null;
    dueAt?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  if (!body.content || typeof body.content !== 'string') {
    return errorResponse({ code: 'INVALID_REQUEST', message: 'Content is required', status: 400 });
  }

  if (body.content.length > MAX_CONTENT_LENGTH) {
    return errorResponse({ code: 'CONTENT_TOO_LONG', message: `Content exceeds ${MAX_CONTENT_LENGTH} characters`, status: 400 });
  }

  if (body.parentId && !config.allowReplies) {
    return errorResponse({ code: 'REPLIES_DISABLED', message: 'Replies are disabled', status: 403 });
  }

  if (body.parentId) {
    const depth = await getCommentDepth(ctx, body.parentId);
    if (depth === null) {
      return errorResponse({ code: 'PARENT_NOT_FOUND', message: 'Parent comment not found', status: 404 });
    }
    if (depth >= config.maxDepth) {
      return errorResponse({ code: 'MAX_DEPTH', message: `Maximum reply depth reached (${config.maxDepth})`, status: 400 });
    }
  }

  // File comments (work/042 P2): posting to an asset-bucket artifact requires file 'comment'
  // access (member of a workspace-visible/own file, or a sharee with a comment grant).
  if (await isAssetBucketArtifact(ctx)) {
    const gate = await authorizeFileComment(request, ctx, body.contextId ?? null, 'comment');
    if (gate) return gate;
  }

  const identity = await validateIdentity(request, ctx, config, body.authorName);
  if (identity instanceof Response) return identity;

  let assigneeUserId: string | null = null;
  let assigneeEmail: string | null = null;
  let dueAt: string | null = null;
  const assigneeInput = typeof body.assignee === 'string' ? body.assignee.trim() : '';
  if (assigneeInput) {
    const session = await getSession(request, ctx);
    if (!session) {
      return errorResponse({ code: 'AUTH_REQUIRED', message: 'Sign in to assign', status: 401 });
    }
    const resolved = await resolveAssignee(ctx, assigneeInput);
    if (!resolved) {
      return errorResponse({ code: 'ASSIGNEE_NOT_FOUND', message: 'Assignee is not on this artifact', status: 400 });
    }
    assigneeEmail = resolved.email;
    assigneeUserId = resolved.userId;
  }
  if (body.dueAt != null) {
    if (typeof body.dueAt !== 'string' || Number.isNaN(Date.parse(body.dueAt))) {
      return errorResponse({ code: 'INVALID_REQUEST', message: 'dueAt must be a valid date', status: 400 });
    }
    dueAt = body.dueAt;
  }

  const id = generateId('cmt');
  const now = new Date().toISOString();

  const mentions = Array.isArray(body.mentions) ? body.mentions.filter((m) => typeof m === 'string') : [];
  const positionJson = body.position != null ? JSON.stringify(body.position) : null;
  const stateJson = body.state != null ? JSON.stringify(body.state) : null;
  const mentionsJson = mentions.length ? JSON.stringify(mentions) : null;

  await ctx.env.DB.prepare(
    `INSERT INTO artifact_comments (id, artifact_id, context_id, parent_id, author_id, author_name, content, created_at, updated_at, position, state, mentions, assignee_user_id, assignee_email, due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    ctx.artifactId,
    body.contextId || null,
    body.parentId || null,
    identity.authorId,
    identity.authorName,
    body.content,
    now,
    now,
    positionJson,
    stateJson,
    mentionsJson,
    assigneeUserId,
    assigneeEmail,
    dueAt,
  ).run();

  const comment: Comment = {
    id,
    contextId: body.contextId || null,
    parentId: body.parentId || null,
    authorId: identity.authorId,
    authorName: identity.authorName,
    content: body.content,
    createdAt: now,
    updatedAt: now,
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    position: body.position ?? null,
    state: body.state ?? null,
    mentions,
    authorType: 'human',
    assigneeUserId,
    assigneeEmail,
    dueAt,
  };

  if (ctx.waitUntil) ctx.waitUntil(broadcastEvent(ctx, { type: 'comment:added', comment }));
  else await broadcastEvent(ctx, { type: 'comment:added', comment });

  dispatchCommentNotify(ctx, comment);
  emitJobEvent(ctx.env, ctx.artifactId, 'comment.added').catch(() => {});

  return successResponse(comment, 201);
}

/** GET `/:id` — fetch a single comment. */
export async function getComment(request: Request, ctx: DataContext, commentId: string): Promise<Response> {
  const row = await ctx.env.DB.prepare(
    'SELECT * FROM artifact_comments WHERE artifact_id = ? AND id = ?'
  ).bind(ctx.artifactId, commentId).first<CommentRow>();

  if (!row) {
    return errorResponse({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found', status: 404 });
  }

  if (await isAssetBucketArtifact(ctx)) {
    const gate = await authorizeFileComment(request, ctx, row.context_id, 'view');
    if (gate) return gate;
  }

  const comment = rowToComment(row);
  await attachReactions(request, ctx, [comment]);
  return successResponse(comment);
}

/** GET `/:id/replies` — list direct replies to a comment. */
export async function getReplies(request: Request, ctx: DataContext, parentId: string): Promise<Response> {
  if (await isAssetBucketArtifact(ctx)) {
    const parent = await ctx.env.DB.prepare('SELECT context_id FROM artifact_comments WHERE artifact_id = ? AND id = ?')
      .bind(ctx.artifactId, parentId).first<{ context_id: string | null }>();
    const gate = await authorizeFileComment(request, ctx, parent?.context_id ?? null, 'view');
    if (gate) return gate;
  }

  const result = await ctx.env.DB.prepare(
    'SELECT * FROM artifact_comments WHERE artifact_id = ? AND parent_id = ? ORDER BY created_at ASC'
  ).bind(ctx.artifactId, parentId).all<CommentRow>();

  const replies: Comment[] = result.results.map(rowToComment);
  await attachReactions(request, ctx, replies);

  return successResponse({ replies, count: replies.length });
}

/** PATCH `/:id` — edit comment content (author or owner). */
export async function editComment(
  request: Request,
  ctx: DataContext,
  commentId: string,
): Promise<Response> {
  let body: { content: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  if (!body.content || typeof body.content !== 'string') {
    return errorResponse({ code: 'INVALID_REQUEST', message: 'Content is required', status: 400 });
  }

  if (body.content.length > MAX_CONTENT_LENGTH) {
    return errorResponse({ code: 'CONTENT_TOO_LONG', message: `Content exceeds ${MAX_CONTENT_LENGTH} characters`, status: 400 });
  }

  const existing = await ctx.env.DB.prepare(
    'SELECT * FROM artifact_comments WHERE artifact_id = ? AND id = ?'
  ).bind(ctx.artifactId, commentId).first<CommentRow>();

  if (!existing) {
    return errorResponse({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found', status: 404 });
  }

  const isOwner = await verifyOwner(request, ctx);
  const isAuthor = await checkIsAuthor(request, ctx, existing.author_id);

  if (!isOwner && !isAuthor) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only author or owner can edit', status: 403 });
  }

  const now = new Date().toISOString();

  await ctx.env.DB.prepare(
    'UPDATE artifact_comments SET content = ?, updated_at = ? WHERE id = ?'
  ).bind(body.content, now, commentId).run();

  const comment: Comment = { ...rowToComment(existing), content: body.content, updatedAt: now };

  await broadcastEvent(ctx, { type: 'comment:updated', comment });

  return successResponse(comment);
}

/** DELETE `/:id` — remove a comment (author or owner). */
export async function deleteComment(
  request: Request,
  ctx: DataContext,
  commentId: string,
): Promise<Response> {
  const existing = await ctx.env.DB.prepare(
    'SELECT * FROM artifact_comments WHERE artifact_id = ? AND id = ?'
  ).bind(ctx.artifactId, commentId).first<CommentRow>();

  if (!existing) {
    return errorResponse({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found', status: 404 });
  }

  const isOwner = await verifyOwner(request, ctx);
  const isAuthor = await checkIsAuthor(request, ctx, existing.author_id);

  if (!isOwner && !isAuthor) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only author or owner can delete', status: 403 });
  }

  await ctx.env.DB.prepare(
    'DELETE FROM artifact_comments WHERE id = ?'
  ).bind(commentId).run();

  await broadcastEvent(ctx, { type: 'comment:deleted', comment: rowToComment(existing) });

  return successResponse({ deleted: true });
}
