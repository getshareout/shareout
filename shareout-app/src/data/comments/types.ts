/**
 * Shared types and constants for the artifact comments data tier.
 *
 * Comments live in shared D1 (`artifact_comments`) with per-artifact config in
 * the mini-store (`artifact_json`, key `_comments_config`). Real-time updates
 * fan out through the COMMENTS Durable Object.
 */

/** Maximum characters allowed in comment body text. */
export const MAX_CONTENT_LENGTH = 10_000;

/** Soft cap on comments per context (reserved for future enforcement). */
export const MAX_COMMENTS_PER_CONTEXT = 10_000;

/** Valid comment id format: `cmt_` + 24 hex chars. */
export const COMMENT_ID_PATTERN = /^cmt_[a-f0-9]{24}$/;

/** Mini-store key for per-artifact comments configuration. */
export const CONFIG_KEY = '_comments_config';

/** Maximum emoji reaction string length. */
export const MAX_EMOJI_LENGTH = 16;

/** API-facing comment shape (camelCase). */
export interface Comment {
  id: string;
  contextId: string | null;
  parentId: string | null;
  authorId: string | null;
  authorName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  position: unknown | null;
  state: unknown | null;
  mentions: string[];
  authorType: 'human' | 'agent';
  assigneeUserId: string | null;
  assigneeEmail: string | null;
  dueAt: string | null;
  reactions?: Record<string, { count: number; mine: boolean }>;
}

/** D1 row shape for `artifact_comments` (snake_case). */
export interface CommentRow {
  id: string;
  context_id: string | null;
  parent_id: string | null;
  author_id: string | null;
  author_name: string;
  content: string;
  created_at: string;
  updated_at: string;
  resolved?: number | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  position?: string | null;
  state?: string | null;
  mentions?: string | null;
  author_type?: string | null;
  assignee_user_id?: string | null;
  assignee_email?: string | null;
  due_at?: string | null;
}

/** Per-artifact comments feature configuration. */
export interface CommentsConfig {
  enabled: boolean;
  identityMode: 'anonymous' | 'named' | 'authenticated';
  allowReplies: boolean;
  maxDepth: number;
  overlayEnabled: boolean;
}

/** WebSocket broadcast payload for comment lifecycle events. */
export interface CommentEvent {
  type: 'comment:added' | 'comment:updated' | 'comment:deleted' | 'comment:resolved';
  comment: Comment;
}

/** Workspace member / collaborator row from people queries. */
export interface PersonRow {
  user_id: string | null;
  email: string;
  name: string | null;
  role: string | null;
}

/** Normalized person entry returned by `_people`. */
export interface CommentPerson {
  id: string | null;
  email: string;
  name: string | null;
  role: string | null;
}

export const DEFAULT_CONFIG: CommentsConfig = {
  enabled: true,
  identityMode: 'anonymous',
  allowReplies: true,
  maxDepth: 3,
  overlayEnabled: true,
};
