import { generateId } from '../../crypto-utils';
import type { DataContext } from '../middleware';
import { dispatchCommentNotify } from '../comment-notify';
import { MAX_CONTENT_LENGTH, type Comment } from './types';
import { resolveAssignee } from './people';
import { broadcastEvent } from './broadcast';

/**
 * Create a top-level comment attributed to a non-human author (e.g. a Crew),
 * returning data (not a Response). No request/identity validation — the caller
 * supplies the author. Used by the Crew comment_create write tool.
 */
export async function createCommentForTool(
  ctx: DataContext,
  author: { id: string; name: string },
  body: { content: string; contextId?: string; mentions?: string[]; assigneeEmail?: string; dueAt?: string },
): Promise<{ comment: Comment } | { error: string }> {
  if (!body.content || typeof body.content !== 'string') return { error: 'content is required' };
  if (body.content.length > MAX_CONTENT_LENGTH) {
    return { error: `content exceeds ${MAX_CONTENT_LENGTH} characters` };
  }

  let assigneeUserId: string | null = null;
  let assigneeEmail: string | null = null;
  let dueAt: string | null = null;
  const assigneeInput = typeof body.assigneeEmail === 'string' ? body.assigneeEmail.trim() : '';
  if (assigneeInput) {
    const resolved = await resolveAssignee(ctx, assigneeInput);
    if (!resolved) return { error: 'assignee is not on this artifact' };
    assigneeEmail = resolved.email;
    assigneeUserId = resolved.userId;
  }
  if (body.dueAt != null) {
    if (typeof body.dueAt !== 'string' || Number.isNaN(Date.parse(body.dueAt))) {
      return { error: 'dueAt must be a valid date' };
    }
    dueAt = body.dueAt;
  }

  const id = generateId('cmt');
  const now = new Date().toISOString();
  const mentions = Array.isArray(body.mentions) ? body.mentions.filter((m) => typeof m === 'string') : [];
  const mentionsJson = mentions.length ? JSON.stringify(mentions) : null;

  await ctx.env.DB.prepare(
    `INSERT INTO artifact_comments (id, artifact_id, context_id, parent_id, author_id, author_name, content, created_at, updated_at, position, state, mentions, author_type, assignee_user_id, assignee_email, due_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, 'agent', ?, ?, ?)`
  )
    .bind(id, ctx.artifactId, body.contextId || null, author.id, author.name, body.content, now, now, mentionsJson, assigneeUserId, assigneeEmail, dueAt)
    .run();

  const comment: Comment = {
    id,
    contextId: body.contextId || null,
    parentId: null,
    authorId: author.id,
    authorName: author.name,
    content: body.content,
    createdAt: now,
    updatedAt: now,
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    position: null,
    state: null,
    mentions,
    authorType: 'agent',
    assigneeUserId,
    assigneeEmail,
    dueAt,
  };

  await broadcastEvent(ctx, { type: 'comment:added', comment });
  dispatchCommentNotify(ctx, comment);
  return { comment };
}
