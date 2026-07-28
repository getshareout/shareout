import type { ChatMessage } from '../agent-loop';
import type { PendingAction } from '../actions';

/** A proposed write awaiting the user's confirm/cancel tap. */
export interface PendingRecord {
  action: PendingAction;
  /** Platform message ref to edit after confirm (bots); omitted for web. */
  messageRef?: string | null;
}

/**
 * Per-conversation history + pending-approval persistence. One impl per delivery
 * model: DO SQLite (bots), D1 + KV (web account chat), artifact tables (visitor).
 * Lets each surface keep its own transport while sharing the engine contract.
 */
export interface ConversationStore {
  loadHistory(limit: number): Promise<ChatMessage[]>;
  appendMessage(role: 'user' | 'assistant', content: string): Promise<void>;
  putPending(token: string, rec: PendingRecord): Promise<void>;
  /** Returns and consumes the pending record, or null if absent/not-permitted. */
  takePending(token: string): Promise<PendingRecord | null>;
}
