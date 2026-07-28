/**
 * Bounded conversation memory for normal editor chat.
 *
 * Stores recent user/assistant turns in D1 so follow-up prompts retain context
 * without sending the full HTML history on every request. One `agent_threads` row
 * per (artifact, author) with scope_type='editor', its turns in `agent_messages` —
 * the same tables every other chat surface uses. The old table kept a whole
 * exchange as one JSON blob, which is why the id is derived rather than random:
 * the thread has to be found again on the next turn.
 */

import type { Env } from '../../types';
import { generateId } from '../../crypto-utils';
import { debugError } from './config';

/** Exchanges replayed into the model prompt (each exchange = user + assistant). */
export const MAX_HISTORY_TURNS = 8;
/** Cap per stored message body to keep rows small. */
export const MAX_TURN_CHARS = 2000;
/** Rows retained per (artifact, user) after pruning. */
export const MAX_STORED_TURNS = 24;

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** Load recent normal-chat turns as alternating user/assistant messages (chronological). */
export async function loadConversationHistory(
  env: Env,
  artifactId: string,
  userId: string
): Promise<ChatMessage[]> {
  try {
    const rows = await env.DB.prepare(`
      SELECT m.role, m.content FROM agent_messages m
      JOIN agent_threads t ON t.id = m.thread_id
      WHERE t.scope_type = 'editor' AND t.scope_key = ? AND t.user_id = ?
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?
    `).bind(artifactId, userId, MAX_HISTORY_TURNS * 2).all<{ role: string; content: string }>();

    return (rows.results || [])
      .slice()
      .reverse()
      .map((r) => ({
        role: r.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: r.content.slice(0, MAX_TURN_CHARS),
      }));
  } catch (err) {
    debugError('HISTORY', 'loadConversationHistory failed', err);
    return [];
  }
}

/** Persist one normal-chat exchange and prune older rows to keep the table bounded. */
export async function storeConversationTurn(
  env: Env,
  artifactId: string,
  userId: string,
  prompt: string,
  reply: string
): Promise<void> {
  try {
    const threadId = await ensureEditorThread(env, artifactId, userId);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO agent_messages (id, thread_id, role, content) VALUES (?, ?, 'user', ?)`
      ).bind(generateId('msg'), threadId, prompt.slice(0, MAX_TURN_CHARS)),
      env.DB.prepare(
        `INSERT INTO agent_messages (id, thread_id, role, content) VALUES (?, ?, 'assistant', ?)`
      ).bind(generateId('msg'), threadId, (reply || '').slice(0, MAX_TURN_CHARS)),
      env.DB.prepare(
        `UPDATE agent_threads SET message_count = message_count + 2,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      ).bind(threadId),
    ]);

    // Keep the newest MAX_STORED_TURNS exchanges (two messages each).
    await env.DB.prepare(`
      DELETE FROM agent_messages
      WHERE thread_id = ?
        AND id NOT IN (
          SELECT id FROM agent_messages
          WHERE thread_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        )
    `).bind(threadId, threadId, MAX_STORED_TURNS * 2).run();
  } catch (err) {
    debugError('HISTORY', 'storeConversationTurn failed', err);
  }
}

/** One editor thread per (artifact, author), created on first use.
 *  ponytail: read-then-insert, with a partial unique index as the real guard — two
 *  concurrent first turns race, the loser's INSERT fails into the caller's catch and
 *  that one turn isn't stored. Cheaper than a transaction D1 doesn't have. */
async function ensureEditorThread(env: Env, artifactId: string, userId: string): Promise<string> {
  const existing = await env.DB.prepare(
    `SELECT id FROM agent_threads WHERE scope_type = 'editor' AND scope_key = ? AND user_id = ?`
  ).bind(artifactId, userId).first<{ id: string }>();
  if (existing) return existing.id;

  const id = generateId('ectx');
  await env.DB.prepare(
    `INSERT INTO agent_threads (id, scope_type, scope_key, user_id, title) VALUES (?, 'editor', ?, ?, 'Editor chat')`
  ).bind(id, artifactId, userId).run();
  return id;
}
