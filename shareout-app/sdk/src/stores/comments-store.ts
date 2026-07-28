import { ShareOutError } from '../shareout-error';
import type { SdkClient } from '../core/sdk-client';
import { CommentsQuery } from './comments-query';
import type { Comment, CommentEvent, CommentEventListener, CommentsConfig, CommentThread, CommentPosition, ReactionResult } from './comment-types';

type CaptureStateFn = () => unknown | Promise<unknown>;
type RestoreStateFn = (state: unknown) => void | Promise<void>;

export class CommentsStore {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<CommentEventListener>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private captureStateFn: CaptureStateFn | null = null;
  private restoreStateFn: RestoreStateFn | null = null;
  private stateBridgeInstalled = false;

  constructor(private sdk: SdkClient) {}

  async add(options: {
    content: string;
    contextId?: string;
    parentId?: string;
    authorName?: string;
    position?: CommentPosition;
    state?: unknown;
    mentions?: string[];
  }): Promise<Comment> {
    const body: Record<string, unknown> = { ...options };
    if (body.state === undefined && this.captureStateFn) {
      try { body.state = await this.captureStateFn(); } catch { /* ignore capture errors */ }
    }
    return this.sdk._internalFetch<Comment>('/comments', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Register a callback that returns a JSON-serializable snapshot of the app's
   * current view (e.g. dashboard filters). When a comment is pinned, this state
   * is stored with it and replayed via onRestoreState when the comment is opened.
   */
  onCaptureState(fn: CaptureStateFn): void {
    this.captureStateFn = fn;
    this.installStateBridge();
  }

  /** Register a callback that restores the app to a previously captured state. */
  onRestoreState(fn: RestoreStateFn): void {
    this.restoreStateFn = fn;
    this.installStateBridge();
  }

  private installStateBridge(): void {
    if (this.stateBridgeInstalled) return;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    this.stateBridgeInstalled = true;
    window.addEventListener('message', (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'shareout:comments:captureState') {
        const reply = (state: unknown) => {
          try {
            window.parent.postMessage({ type: 'shareout:comments:stateCaptured', requestId: data.requestId, state }, '*');
          } catch { /* ignore */ }
        };
        if (this.captureStateFn) {
          Promise.resolve().then(() => this.captureStateFn!()).then(reply).catch(() => reply(null));
        } else {
          reply(null);
        }
      } else if (data.type === 'shareout:comments:restoreState') {
        if (this.restoreStateFn) {
          try { Promise.resolve(this.restoreStateFn(data.state)).catch(() => {}); } catch { /* ignore */ }
        }
      }
    });
  }

  async reply(
    parentId: string,
    content: string,
    authorName?: string
  ): Promise<Comment> {
    return this.add({ content, parentId, authorName });
  }

  /** Toggle an emoji reaction on a comment for the current user. Returns the new summary. */
  async react(id: string, emoji: string): Promise<ReactionResult> {
    return this.sdk._internalFetch<ReactionResult>(`/comments/${encodeURIComponent(id)}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
  }

  /** Mark an action item resolved (or reopen with resolved: false). Requires session. */
  async resolve(id: string, resolved = true): Promise<Comment> {
    return this.sdk._internalFetch<Comment>(`/comments/${encodeURIComponent(id)}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved }),
    });
  }

  /**
   * Assign (or unassign) an action item. `assignee` is an email in the artifact's
   * people set, or null/empty to clear. Optional `dueAt` ISO date.
   */
  async assign(
    id: string,
    options: { assignee?: string | null; dueAt?: string | null } = {},
  ): Promise<Comment> {
    return this.sdk._internalFetch<Comment>(`/comments/${encodeURIComponent(id)}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({
        assignee: options.assignee === undefined ? null : options.assignee,
        dueAt: options.dueAt,
      }),
    });
  }

  async edit(id: string, content: string): Promise<Comment> {
    return this.sdk._internalFetch<Comment>(`/comments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.sdk._internalFetch(`/comments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      return true;
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'COMMENT_NOT_FOUND') {
        return false;
      }
      throw e;
    }
  }

  find(filter?: { contextId?: string; parentId?: string | null }): CommentsQuery {
    return new CommentsQuery(this.sdk, filter);
  }

  async findById(id: string): Promise<Comment | null> {
    try {
      return await this.sdk._internalFetch<Comment>(
        `/comments/${encodeURIComponent(id)}`
      );
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'COMMENT_NOT_FOUND') {
        return null;
      }
      throw e;
    }
  }

  async getReplies(parentId: string): Promise<Comment[]> {
    const result = await this.sdk._internalFetch<{ replies: Comment[]; count: number }>(
      `/comments/${encodeURIComponent(parentId)}/replies`
    );
    return result.replies;
  }

  async getThread(rootId: string): Promise<CommentThread> {
    const root = await this.findById(rootId);
    if (!root) {
      throw new ShareOutError('Comment not found', 'COMMENT_NOT_FOUND', 404);
    }
    return this.buildThread(root);
  }

  private async buildThread(comment: Comment): Promise<CommentThread> {
    const replies = await this.getReplies(comment.id);
    const childThreads = await Promise.all(
      replies.map(reply => this.buildThread(reply))
    );
    return { comment, replies: childThreads };
  }

  async getConfig(): Promise<CommentsConfig> {
    return this.sdk._internalFetch<CommentsConfig>('/comments/_config');
  }

  async setConfig(config: Partial<CommentsConfig>): Promise<CommentsConfig> {
    return this.sdk._internalFetch<CommentsConfig>('/comments/_config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  subscribe(handler: CommentEventListener): () => void {
    this.ensureConnection();
    const key = '*';
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(handler);
    return () => {
      this.listeners.get(key)?.delete(handler);
      this.maybeDisconnect();
    };
  }

  subscribeToContext(contextId: string, handler: CommentEventListener): () => void {
    this.ensureConnection();
    const key = `context:${contextId}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(handler);
    return () => {
      this.listeners.get(key)?.delete(handler);
      this.maybeDisconnect();
    };
  }

  private ensureConnection(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;

    const wsUrl = this.sdk._baseUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');

    const url = `${wsUrl}/v1/data/${this.sdk._artifactId}/comments/ws`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as CommentEvent | { type: string };
        if (data.type === 'connected' || data.type === 'pong') return;

        const commentEvent = data as CommentEvent;
        this.notifyListeners(commentEvent);
      } catch {}
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {};
  }

  private notifyListeners(event: CommentEvent): void {
    // Notify global listeners
    this.listeners.get('*')?.forEach(fn => fn(event));

    // Notify context-specific listeners
    if (event.comment.contextId) {
      const key = `context:${event.comment.contextId}`;
      this.listeners.get(key)?.forEach(fn => fn(event));
    }
  }

  private maybeDisconnect(): void {
    let hasListeners = false;
    for (const set of this.listeners.values()) {
      if (set.size > 0) {
        hasListeners = true;
        break;
      }
    }

    if (!hasListeners && this.ws) {
      this.ws.close();
      this.ws = null;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    let hasListeners = false;
    for (const set of this.listeners.values()) {
      if (set.size > 0) {
        hasListeners = true;
        break;
      }
    }

    if (!hasListeners) return;
    if (this.reconnectAttempts >= 10) return;

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnection();
    }, delay);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 10;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
  }
}

