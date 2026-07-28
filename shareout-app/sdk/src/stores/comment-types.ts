// Comments types
export interface CommentPosition {
  selector?: string;
  relX?: number;
  relY?: number;
  pctX?: number;
  pctY?: number;
  scrollY?: number;
}

export interface Comment {
  id: string;
  contextId: string | null;
  parentId: string | null;
  authorId: string | null;
  authorName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  resolved?: boolean;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  position?: CommentPosition | null;
  state?: unknown | null;
  mentions?: string[];
  /** 'agent' for comments left by a Crew/AI agent, else 'human'. */
  authorType?: 'human' | 'agent';
  /** Emoji → { count, mine } summary for this comment. */
  reactions?: Record<string, { count: number; mine: boolean }>;
  assigneeUserId?: string | null;
  assigneeEmail?: string | null;
  dueAt?: string | null;
}

export interface ReactionResult {
  commentId: string;
  emoji: string;
  reacted: boolean;
  reactions: Record<string, { count: number; mine: boolean }>;
}

export interface CommentsConfig {
  enabled: boolean;
  identityMode: 'anonymous' | 'named' | 'authenticated';
  allowReplies: boolean;
  maxDepth: number;
  overlayEnabled?: boolean;
}

export interface CommentEvent {
  type: 'comment:added' | 'comment:updated' | 'comment:deleted' | 'comment:resolved';
  comment: Comment;
}

export interface ReactionEvent {
  type: 'comment:reaction';
  commentId: string;
  reactions: Record<string, { count: number; mine: boolean }>;
}

export interface CommentThread {
  comment: Comment;
  replies: CommentThread[];
}

export type CommentEventListener = (event: CommentEvent) => void;
