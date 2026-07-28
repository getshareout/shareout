import type { Env } from '../../types';
import { generateId } from '../../crypto-utils';
import type { ChatMessage } from '../agent-loop';
import type { ConversationStore, PendingRecord } from './types';

const DEFAULT_HISTORY_LIMIT = 40;

/**
 * ConversationStore for the in-artifact visitor agent, over the shared
 * `agent_threads` / `agent_messages` tables (scope_type='artifact_visitor'). Conforms to the same contract
 * as the bot/web stores so every chat surface persists through one interface —
 * but the visitor shell keeps its own streaming, billing, and token bookkeeping
 * (see appendAssistantTurn), which the thin base interface doesn't model.
 *
 * Visitor chat has no confirmable write actions, so the pending methods are inert.
 */
export class VisitorStore implements ConversationStore {
  constructor(private env: Env, private conversationId: string) {}

  /** Create a new visitor conversation and return a store bound to it. */
  static async create(env: Env, artifactId: string, title: string): Promise<VisitorStore> {
    const id = generateId('conv');
    await env.DB.prepare(
      `INSERT INTO agent_threads (id, scope_type, scope_key, title, created_at, updated_at)
       VALUES (?, 'artifact_visitor', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).bind(id, artifactId, title.slice(0, 100)).run();
    return new VisitorStore(env, id);
  }

  get id(): string {
    return this.conversationId;
  }

  async loadHistory(limit: number = DEFAULT_HISTORY_LIMIT): Promise<ChatMessage[]> {
    const rows = await this.env.DB.prepare(
      `SELECT role, content FROM agent_messages
         WHERE thread_id = ?
         ORDER BY created_at DESC LIMIT ?`
    ).bind(this.conversationId, limit).all<{ role: string; content: string }>();
    return rows.results
      .reverse()
      .map((r) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content }));
  }

  async appendMessage(role: 'user' | 'assistant', content: string): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO agent_messages (id, thread_id, role, content, created_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).bind(generateId('msg'), this.conversationId, role, content).run();
  }

  /**
   * Persist an assistant turn with token usage + model and roll up the
   * conversation counters. Visitor-specific (the base contract carries no tokens).
   */
  async appendAssistantTurn(content: string, inputTokens: number, outputTokens: number, model: string): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO agent_messages (id, thread_id, role, content, input_tokens, output_tokens, model, created_at)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).bind(generateId('msg'), this.conversationId, content, inputTokens, outputTokens, model).run();
    await this.env.DB.prepare(
      `UPDATE agent_threads
         SET message_count = message_count + 2,
             total_input_tokens = total_input_tokens + ?,
             total_output_tokens = total_output_tokens + ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`
    ).bind(inputTokens, outputTokens, this.conversationId).run();
  }

  // Visitor chat proposes no confirmable writes — pending storage is inert.
  async putPending(_token: string, _rec: PendingRecord): Promise<void> {}
  async takePending(_token: string): Promise<PendingRecord | null> {
    return null;
  }
}
