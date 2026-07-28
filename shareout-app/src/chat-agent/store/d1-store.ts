import type { Env } from '../../types';
import { generateId } from '../../crypto-utils';
import type { ChatMessage } from '../agent-loop';
import type { PendingAction } from '../actions';
import type { ConversationStore, PendingRecord } from './types';

const PENDING_TTL_S = 600;

/**
 * ConversationStore for the web account chat (home + workspace assistants).
 * History lives in `agent_messages` under one `agent_threads` row
 * (scope_type='workspace'); pending approvals live in RATE_LIMIT_KV, owner-scoped
 * so another user can't redeem someone else's token. `scopeKey` is a workspace id
 * or the personal sentinel. Every message belongs to a thread — the caller creates
 * one before the first turn.
 */
export class D1ConversationStore implements ConversationStore {
  constructor(private env: Env, private scopeKey: string, private userId: string, private threadId: string) {}

  async loadHistory(limit: number): Promise<ChatMessage[]> {
    const rows = await this.env.DB.prepare(
      `SELECT role, content FROM agent_messages
         WHERE thread_id = ?
         ORDER BY created_at DESC LIMIT ?`
    ).bind(this.threadId, limit).all<{ role: string; content: string }>();
    return rows.results
      .reverse()
      .map((r) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content }));
  }

  async appendMessage(role: 'user' | 'assistant', content: string): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO agent_messages (id, thread_id, role, content) VALUES (?, ?, ?, ?)`
    ).bind(generateId('wam'), this.threadId, role, content).run();
    await this.env.DB.prepare(
      `UPDATE agent_threads SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).bind(this.threadId).run();
  }

  async putPending(token: string, rec: PendingRecord): Promise<void> {
    if (!this.env.RATE_LIMIT_KV) throw new Error('pending store unavailable');
    await this.env.RATE_LIMIT_KV.put(
      `agent:pending:${token}`,
      JSON.stringify({ userId: this.userId, wsId: this.scopeKey, action: rec.action }),
      { expirationTtl: PENDING_TTL_S }
    );
  }

  async takePending(token: string): Promise<PendingRecord | null> {
    if (!this.env.RATE_LIMIT_KV) return null;
    const raw = await this.env.RATE_LIMIT_KV.get(`agent:pending:${token}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId: string; wsId: string; action: PendingAction };
    if (parsed.userId !== this.userId || parsed.wsId !== this.scopeKey) return null;
    await this.env.RATE_LIMIT_KV.delete(`agent:pending:${token}`);
    return { action: parsed.action };
  }
}
