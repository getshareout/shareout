import { generateId } from '../../crypto-utils';
import { successResponse, errorResponse, type DataContext } from '../middleware';
import { MAX_EMOJI_LENGTH, type Comment, type CommentRow } from './types';
import { getSession } from './auth';
import { broadcastRaw } from './broadcast';

async function reactionSummary(
  ctx: DataContext,
  commentIds: string[],
  viewerId: string | null,
): Promise<Record<string, Record<string, { count: number; mine: boolean }>>> {
  const out: Record<string, Record<string, { count: number; mine: boolean }>> = {};
  if (!commentIds.length) return out;

  const placeholders = commentIds.map(() => '?').join(',');
  const rows = await ctx.env.DB.prepare(
    `SELECT comment_id, emoji, COUNT(*) AS count,
            SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine
       FROM comment_reactions
      WHERE comment_id IN (${placeholders})
      GROUP BY comment_id, emoji`
  ).bind(viewerId ?? '', ...commentIds).all<{ comment_id: string; emoji: string; count: number; mine: number }>();

  for (const r of rows.results) {
    if (!out[r.comment_id]) out[r.comment_id] = {};
    out[r.comment_id][r.emoji] = { count: Number(r.count), mine: Number(r.mine) > 0 };
  }
  return out;
}

/** Attach aggregated emoji reactions to comment objects in place. */
export async function attachReactions(
  request: Request,
  ctx: DataContext,
  comments: Comment[],
): Promise<void> {
  if (!comments.length) return;
  const session = await getSession(request, ctx);
  const summary = await reactionSummary(ctx, comments.map((c) => c.id), session?.userId ?? null);
  for (const c of comments) {
    c.reactions = summary[c.id] || {};
  }
}

/** POST `/:id/reactions` — toggle an emoji reaction. */
export async function reactComment(
  request: Request,
  ctx: DataContext,
  commentId: string,
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const session = await getSession(request, ctx);
  if (!session) {
    return errorResponse({ code: 'AUTH_REQUIRED', message: 'Sign in to react', status: 401 });
  }

  let body: { emoji?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : '';
  if (!emoji || emoji.length > MAX_EMOJI_LENGTH) {
    return errorResponse({ code: 'INVALID_REQUEST', message: 'A short emoji is required', status: 400 });
  }

  const exists = await ctx.env.DB.prepare(
    'SELECT id FROM artifact_comments WHERE artifact_id = ? AND id = ?'
  ).bind(ctx.artifactId, commentId).first<{ id: string }>();
  if (!exists) {
    return errorResponse({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found', status: 404 });
  }

  const existing = await ctx.env.DB.prepare(
    'SELECT id FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?'
  ).bind(commentId, session.userId, emoji).first<{ id: string }>();

  let reacted: boolean;
  if (existing) {
    await ctx.env.DB.prepare('DELETE FROM comment_reactions WHERE id = ?').bind(existing.id).run();
    reacted = false;
  } else {
    await ctx.env.DB.prepare(
      'INSERT INTO comment_reactions (id, artifact_id, comment_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(generateId('rct'), ctx.artifactId, commentId, session.userId, emoji, new Date().toISOString()).run();
    reacted = true;
  }

  const summary = await reactionSummary(ctx, [commentId], session.userId);
  const reactions = summary[commentId] || {};

  await broadcastRaw(ctx, { type: 'comment:reaction', commentId, reactions });

  return successResponse({ commentId, emoji, reacted, reactions });
}
