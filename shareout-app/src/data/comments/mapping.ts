import type { DataContext } from '../middleware';
import type { Comment, CommentRow } from './types';

/** Parse JSON column values; returns null on empty or invalid input. */
export function safeParse(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Map a D1 comment row to the API-facing Comment shape. */
export function rowToComment(row: CommentRow): Comment {
  const mentions = safeParse(row.mentions);
  return {
    id: row.id,
    contextId: row.context_id,
    parentId: row.parent_id,
    authorId: row.author_id,
    authorName: row.author_name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolved: !!row.resolved,
    resolvedBy: row.resolved_by ?? null,
    resolvedAt: row.resolved_at ?? null,
    position: safeParse(row.position),
    state: safeParse(row.state),
    mentions: Array.isArray(mentions) ? (mentions as string[]) : [],
    authorType: row.author_type === 'agent' ? 'agent' : 'human',
    assigneeUserId: row.assignee_user_id ?? null,
    assigneeEmail: row.assignee_email ?? null,
    dueAt: row.due_at ?? null,
  };
}

/**
 * Walk the parent chain to compute reply depth for `commentId`.
 * Returns null when the starting comment does not exist.
 */
export async function getCommentDepth(ctx: DataContext, commentId: string): Promise<number | null> {
  let depth = 0;
  let currentId: string | null = commentId;

  while (currentId) {
    const row: { parent_id: string | null } | null = await ctx.env.DB.prepare(
      'SELECT parent_id FROM artifact_comments WHERE artifact_id = ? AND id = ?'
    ).bind(ctx.artifactId, currentId).first<{ parent_id: string | null }>();

    if (!row) return depth === 0 ? null : depth;

    depth++;
    currentId = row.parent_id;
  }

  return depth;
}
