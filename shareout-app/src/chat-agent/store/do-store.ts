import type { ChatMessage } from '../agent-loop';
import type { PendingAction } from '../actions';
import type { ConversationStore, PendingRecord } from './types';

/**
 * ConversationStore over a ChatSessionDO's SQLite handle. The DO owns schema
 * creation, update dedup, and turn serialization; this just reads/writes the
 * `messages` and `pending_actions` tables it set up.
 */
export class DoConversationStore implements ConversationStore {
  constructor(private sql: SqlStorage) {}

  async loadHistory(limit: number): Promise<ChatMessage[]> {
    const rows = this.sql
      .exec('SELECT role, content FROM messages ORDER BY seq DESC LIMIT ?', limit)
      .toArray() as Array<{ role: string; content: string }>;
    return rows
      .reverse()
      .map((r) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content }));
  }

  async appendMessage(role: 'user' | 'assistant', content: string): Promise<void> {
    this.sql.exec('INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)', role, content, Date.now());
  }

  async putPending(token: string, rec: PendingRecord): Promise<void> {
    this.sql.exec(
      'INSERT INTO pending_actions (token, action, message_id, created_at) VALUES (?, ?, ?, ?)',
      token, JSON.stringify(rec.action), rec.messageRef != null ? String(rec.messageRef) : null, Date.now()
    );
  }

  async takePending(token: string): Promise<PendingRecord | null> {
    const row = this.sql
      .exec('SELECT action, message_id FROM pending_actions WHERE token = ?', token)
      .toArray()[0] as { action: string; message_id: string | null } | undefined;
    if (!row) return null;
    this.sql.exec('DELETE FROM pending_actions WHERE token = ?', token);
    return { action: JSON.parse(row.action) as PendingAction, messageRef: row.message_id };
  }
}
