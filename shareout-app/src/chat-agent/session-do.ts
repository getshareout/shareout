import type { Env } from '../types';
import type { ChatReplyPort, PlatformId } from '../chat-platforms/types';
import { createTelegramReplyPort } from '../chat-platforms/telegram/reply-port';
import { createSlackReplyPort } from '../chat-platforms/slack/reply-port';
import { parseSlackSessionKey } from '../chat-platforms/slack/linking';
import { runAgentTurn } from './agent-loop';
import { executeAction, describeAction } from './actions';
import { DoConversationStore } from './store/do-store';
import { checkAiChatLimit } from '../rate-limit';
import { generateId } from '../crypto-utils';
import type { WorkspaceSelection } from './access';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS messages (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS seen_updates (
     update_id INTEGER PRIMARY KEY,
     at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS pending_actions (
     token TEXT PRIMARY KEY,
     action TEXT NOT NULL,
     message_id TEXT,
     created_at INTEGER NOT NULL
   )`,
];

const HISTORY_LIMIT = 20;

export interface SessionTurnBody {
  platform: PlatformId;
  sessionKey: string;
  userId: string;
  text: string;
  selectedWorkspaceId?: WorkspaceSelection;
  updateId: number;
  /** Platform-native chat id (Telegram chat_id, Slack team:user). */
  nativeChatId: number | string;
  /** Slack DM channel id when platform is slack. */
  slackChannelId?: string;
}

export interface SessionCallbackBody {
  type: 'callback';
  platform: PlatformId;
  sessionKey: string;
  userId: string;
  data: string;
  callbackId: string;
  messageId: number | string;
  updateId: number;
  nativeChatId: number | string;
  slackChannelId?: string;
}

function createReplyPort(
  env: Env,
  platform: PlatformId,
  nativeChatId: number | string,
  slackChannelId?: string
): ChatReplyPort {
  if (platform === 'telegram') return createTelegramReplyPort(env, nativeChatId as number);
  if (platform === 'slack') {
    const parsed = parseSlackSessionKey(String(nativeChatId));
    if (!parsed) throw new Error(`ChatSessionDO: invalid slack session ${nativeChatId}`);
    return createSlackReplyPort(env, {
      teamId: parsed.teamId,
      slackUserId: parsed.userId,
      channelId: slackChannelId || '',
    });
  }
  throw new Error(`ChatSessionDO: unsupported platform ${platform}`);
}

// One Durable Object per messaging session. Serializes turns, dedups retries by
// update_id, and keeps conversation history + pending approvals in DO SQLite.
export class ChatSessionDO implements DurableObject {
  private sql: SqlStorage;
  private env: Env;
  private store: DoConversationStore;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectState, env: Env) {
    this.sql = state.storage.sql;
    this.env = env;
    this.store = new DoConversationStore(this.sql);
    state.blockConcurrencyWhile(async () => {
      for (const stmt of SCHEMA) this.sql.exec(stmt);
    });
  }

  async fetch(request: Request): Promise<Response> {
    let body: SessionTurnBody | SessionCallbackBody;
    try {
      body = (await request.json()) as SessionTurnBody | SessionCallbackBody;
    } catch {
      return new Response(null, { status: 400 });
    }
    if ((body as SessionCallbackBody).type === 'callback') {
      await this.serialize(() => this.processCallback(body as SessionCallbackBody));
    } else {
      await this.serialize(() => this.processTurn(body as SessionTurnBody));
    }
    return new Response(null, { status: 200 });
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }

  private firstSeen(updateId: number): boolean {
    const seen = this.sql.exec('SELECT 1 FROM seen_updates WHERE update_id = ?', updateId).toArray();
    if (seen.length > 0) return false;
    this.sql.exec('INSERT INTO seen_updates (update_id, at) VALUES (?, ?)', updateId, Date.now());
    return true;
  }

  private async processTurn(b: SessionTurnBody): Promise<void> {
    if (!this.firstSeen(b.updateId)) return;

    const reply = createReplyPort(this.env, b.platform, b.nativeChatId, b.slackChannelId);

    const rl = await checkAiChatLimit(this.env, b.userId);
    if (!rl.allowed) {
      await reply.sendText('You’re going a bit fast for me — give it a minute and try again.');
      return;
    }

    await reply.sendTyping();

    const history = await this.store.loadHistory(HISTORY_LIMIT);

    let result: Awaited<ReturnType<typeof runAgentTurn>>;
    try {
      result = await runAgentTurn(this.env, {
        userId: b.userId,
        ...(typeof b.nativeChatId === 'number' ? { chatId: b.nativeChatId } : {}),
        reply,
        platform: b.platform,
        userText: b.text,
        selectedWorkspaceId: b.selectedWorkspaceId,
        history,
      });
    } catch {
      result = { reply: 'Hmm, something went wrong on my end. Mind trying again?' };
    }

    await this.store.appendMessage('user', b.text);

    if (result.proposal) {
      const token = generateId('pa');
      const summary = describeAction(result.proposal);
      const messageId = await reply.askConfirmation(summary, token);
      await this.store.putPending(token, {
        action: result.proposal,
        messageRef: messageId != null ? String(messageId) : null,
      });
      await this.store.appendMessage('assistant', summary);
      return;
    }

    await this.store.appendMessage('assistant', result.reply);
    await reply.sendText(result.reply);
  }

  private async processCallback(b: SessionCallbackBody): Promise<void> {
    const reply = createReplyPort(this.env, b.platform, b.nativeChatId, b.slackChannelId);

    if (!this.firstSeen(b.updateId)) {
      await reply.answerCallback?.(b.callbackId);
      return;
    }

    const [decision, token] = (b.data || '').split(':');
    const rec = await this.store.takePending(token || '');

    if (!rec) {
      await reply.answerCallback?.(b.callbackId, 'That request expired.');
      return;
    }
    const messageRef = rec.messageRef ?? b.messageId;

    if (decision !== 'ok') {
      await reply.editConfirmation?.(messageRef, '❌ Cancelled.');
      await reply.answerCallback?.(b.callbackId);
      return;
    }

    await reply.answerCallback?.(b.callbackId, 'Working on it…');
    await reply.editConfirmation?.(messageRef, '✅ Confirmed.');

    let resultText: string;
    try {
      resultText = await executeAction(this.env, b.userId, rec.action);
    } catch {
      resultText = 'Something went wrong running that. Try again?';
    }
    await this.store.appendMessage('assistant', resultText);
    await reply.sendText(resultText);
  }
}

/** @deprecated Alias for wrangler DO binding class_name ChatDO */
export const ChatDO = ChatSessionDO;
