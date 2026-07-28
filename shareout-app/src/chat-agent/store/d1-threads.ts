import type { Env } from '../../types';
import { generateId } from '../../crypto-utils';

export interface ThreadSummary {
  id: string;
  title: string;
  updated_at: string;
  preview: string;
}

export interface ThreadMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

const TITLE_MAX = 60;

function deriveTitle(firstText: string): string {
  const t = firstText.trim().replace(/\s+/g, ' ');
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX - 1) + '…' : t || 'New chat';
}

/**
 * Named conversation threads for the web account chat: `agent_threads` rows with
 * scope_type='workspace', their turns in `agent_messages`. Scope key is a
 * workspace id or the personal sentinel; everything is user-scoped.
 */
export class WebThreadStore {
  constructor(private env: Env, private scopeKey: string, private userId: string) {}

  async list(): Promise<ThreadSummary[]> {
    const rows = await this.env.DB.prepare(
      `SELECT t.id, t.title, t.updated_at,
              (SELECT content FROM agent_messages m
                 WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS preview
         FROM agent_threads t
        WHERE t.scope_type = 'workspace' AND t.scope_key = ? AND t.user_id = ?
        ORDER BY t.updated_at DESC LIMIT 100`
    ).bind(this.scopeKey, this.userId).all<{ id: string; title: string | null; updated_at: string; preview: string | null }>();
    return rows.results.map((r) => ({
      id: r.id,
      title: r.title || 'New chat',
      updated_at: r.updated_at,
      preview: (r.preview || '').slice(0, 120),
    }));
  }

  async create(firstText: string): Promise<{ id: string; title: string }> {
    const id = generateId('wat');
    const title = deriveTitle(firstText);
    await this.env.DB.prepare(
      `INSERT INTO agent_threads (id, scope_type, scope_key, user_id, title) VALUES (?, 'workspace', ?, ?, ?)`
    ).bind(id, this.scopeKey, this.userId, title).run();
    return { id, title };
  }

  /** Owner-checked. Returns false if the thread isn't this user's. */
  async rename(id: string, title: string): Promise<boolean> {
    const res = await this.env.DB.prepare(
      `UPDATE agent_threads SET title = ?, updated_at = updated_at
        WHERE id = ? AND scope_type = 'workspace' AND scope_key = ? AND user_id = ?`
    ).bind(deriveTitle(title), id, this.scopeKey, this.userId).run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /** Owner-checked delete; cascades the thread's messages. */
  async remove(id: string): Promise<boolean> {
    const res = await this.env.DB.prepare(
      `DELETE FROM agent_threads WHERE id = ? AND scope_type = 'workspace' AND scope_key = ? AND user_id = ?`
    ).bind(id, this.scopeKey, this.userId).run();
    if ((res.meta?.changes ?? 0) === 0) return false;
    await this.env.DB.prepare(`DELETE FROM agent_messages WHERE thread_id = ?`).bind(id).run();
    return true;
  }

  /** Owner-checked. Paged oldest-first; `before` is an ISO created_at cursor for
   *  scroll-up (the same string the previous page returned). */
  async messages(id: string, limit: number, before?: string): Promise<ThreadMessage[] | null> {
    const owns = await this.env.DB.prepare(
      `SELECT 1 FROM agent_threads WHERE id = ? AND scope_type = 'workspace' AND scope_key = ? AND user_id = ?`
    ).bind(id, this.scopeKey, this.userId).first();
    if (!owns) return null;
    // '9' sorts above every ISO timestamp, so an absent cursor means "newest page".
    const cursor = before || '9';
    const rows = await this.env.DB.prepare(
      `SELECT role, content, created_at FROM agent_messages
        WHERE thread_id = ? AND created_at < ?
        ORDER BY created_at DESC LIMIT ?`
    ).bind(id, cursor, limit).all<{ role: string; content: string; created_at: string }>();
    return rows.results
      .reverse()
      .map((r) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content, created_at: r.created_at }));
  }
}
