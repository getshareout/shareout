import type { Env } from '../types';
import type { ChatReplyPort, PlatformId } from '../chat-platforms/types';
import { createTelegramReplyPort } from '../chat-platforms/telegram/reply-port';
import { createSlackReplyPort } from '../chat-platforms/slack/reply-port';
import { parseSlackSessionKey } from '../chat-platforms/slack/linking';
import { runAgentTurn } from './agent-loop';
import { agentFallbackReplies } from './replies';
import { executeAction, describeAction } from './actions';
import { DoConversationStore } from './store/do-store';
import { checkAiChatLimit } from '../rate-limit';
import { generateId } from '../crypto-utils';
import type { WorkspaceSelection } from './access';
import { PERSONAL_SCOPE } from '../chat-platforms/types';
import { buildHomeSnapshot } from '../router/api/home-agent';
import { localeForRecipient, t, type Locale } from '../i18n';

const BOT_COPY = {
  en: {
    tooFast: 'You’re going a bit fast for me — give it a minute and try again.',
    expired: 'That request expired.',
    cancelled: '❌ Cancelled.',
    working: 'Working on it…',
    confirmed: '✅ Confirmed.',
    failed: 'Something went wrong running that. Try again?',
  },
  es: {
    tooFast: 'Vas un poco rápido para mí. Esperá un minuto y probá de nuevo.',
    expired: 'Ese pedido venció.',
    cancelled: '❌ Cancelado.',
    working: 'Estoy en eso…',
    confirmed: '✅ Confirmado.',
    failed: 'Algo falló al hacerlo. ¿Probás de nuevo?',
  },
};

function botLocale(env: Env, userId: string, selected?: WorkspaceSelection): Promise<Locale> {
  const workspaceId = typeof selected === 'string' && selected !== PERSONAL_SCOPE ? selected : null;
  return localeForRecipient(env, { userId, workspaceId }).catch((): Locale => 'en');
}

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

/** The web home's workspace snapshot for a session scoped to one workspace; '' otherwise or on failure. */
async function workspaceSnapshot(env: Env, userId: string, ws: WorkspaceSelection | undefined): Promise<string> {
  if (typeof ws !== 'string' || ws === PERSONAL_SCOPE) return '';
  try {
    const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
    return await buildHomeSnapshot(env, ws, { id: userId, email: row?.email ?? null, username: null });
  } catch {
    return '';
  }
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

    const locale = await botLocale(this.env, b.userId, b.selectedWorkspaceId);
    const rl = await checkAiChatLimit(this.env, b.userId);
    if (!rl.allowed) {
      await reply.sendText(t(locale, BOT_COPY).tooFast);
      return;
    }

    await reply.sendTyping();

    const [history, workspaceContext] = await Promise.all([
      this.store.loadHistory(HISTORY_LIMIT),
      workspaceSnapshot(this.env, b.userId, b.selectedWorkspaceId),
    ]);

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
        locale,
        ...(workspaceContext ? { workspaceContext } : {}),
      });
    } catch {
      result = { reply: agentFallbackReplies(locale).errored };
    }

    await this.store.appendMessage('user', b.text);
    if (result.toolNotes) await this.store.appendNotes?.(result.toolNotes);

    if (result.proposal) {
      await reply.finishText?.(result.reply);
      const token = generateId('pa');
      const summary = describeAction(result.proposal, locale);
      const messageId = await reply.askConfirmation(summary, token);
      await this.store.putPending(token, {
        action: result.proposal,
        messageRef: messageId != null ? String(messageId) : null,
      });
      await this.store.appendMessage('assistant', summary);
      return;
    }

    await this.store.appendMessage('assistant', result.reply);
    await (reply.finishText ? reply.finishText(result.reply) : reply.sendText(result.reply));
  }

  private async processCallback(b: SessionCallbackBody): Promise<void> {
    const reply = createReplyPort(this.env, b.platform, b.nativeChatId, b.slackChannelId);

    if (!this.firstSeen(b.updateId)) {
      await reply.answerCallback?.(b.callbackId);
      return;
    }

    const copy = t(await botLocale(this.env, b.userId), BOT_COPY);
    const [decision, token] = (b.data || '').split(':');
    const rec = await this.store.takePending(token || '');

    if (!rec) {
      await reply.answerCallback?.(b.callbackId, copy.expired);
      return;
    }
    const messageRef = rec.messageRef ?? b.messageId;

    if (decision !== 'ok') {
      await reply.editConfirmation?.(messageRef, copy.cancelled);
      await reply.answerCallback?.(b.callbackId);
      return;
    }

    await reply.answerCallback?.(b.callbackId, copy.working);
    await reply.editConfirmation?.(messageRef, copy.confirmed);

    let resultText: string;
    try {
      resultText = await executeAction(this.env, b.userId, rec.action);
    } catch {
      resultText = copy.failed;
    }
    await this.store.appendMessage('assistant', resultText);
    await reply.sendText(resultText);
  }
}

/** @deprecated Alias for wrangler DO binding class_name ChatDO */
export const ChatDO = ChatSessionDO;
