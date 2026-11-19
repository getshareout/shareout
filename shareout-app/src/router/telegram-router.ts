import type { Env } from '../types';
import type { FetchContext } from './context';
import type { TelegramUpdate } from '../telegram/types';
import { sendMessage, sendMessageWithButtons, answerCallbackQuery, sendChatAction } from '../telegram/client';
import { transcribeTelegramAudio } from '../telegram/voice';
import {
  consumeLinkCode,
  linkChat,
  getLinkedUserId,
  getSelectedTelegramWorkspace,
  setSelectedTelegramWorkspace,
  unlinkChat,
} from '../telegram/linking';
import { handleAccessRequestTelegramCallback } from '../artifacts/access-requests';
import { artifactCardButtons, artifactCardText } from '../chat-platforms/telegram/format';
import { createTelegramReplyPort } from '../chat-platforms/telegram/reply-port';
import { handleBotButton, handleBotText, type BotChannel } from '../chat-platforms/bot/router';
import { BOT_COPY } from '../chat-platforms/bot/copy';
import { getPlatformOrigin } from '../config/origins';
import { t } from '../i18n';

// Telegram's side of the shared bot (chat-platforms/bot/router.ts): authenticate the webhook,
// turn an update into text or a button tap, and answer through the Bot API. Commands,
// linking and the chat's workspace are the shared bot's, the same as on WhatsApp.

// Telegram retries any non-2xx (and on timeout), so the webhook ALWAYS returns
// 200 — even on bad secret, malformed body, or internal error. Recoverable
// problems are surfaced to the user via sendMessage, not via the HTTP status.
function ok(): Response {
  return new Response(null, { status: 200 });
}

export async function routeTelegram(ctx: FetchContext): Promise<Response | null> {
  const { request, path } = ctx;

  if (path === '/telegram/webhook' && request.method === 'POST') {
    return handleWebhook(ctx);
  }

  return null;
}

async function handleWebhook(ctx: FetchContext): Promise<Response> {
  const { request, env } = ctx;

  // Authenticate: Telegram echoes the secret we registered via setWebhook.
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return ok();
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return ok();
  }

  const work = dispatchUpdate(env, update);
  if (ctx.executionCtx) {
    ctx.executionCtx.waitUntil(work);
  } else {
    await work;
  }
  return ok();
}

/** The shared bot's view of one Telegram chat. */
export function telegramChannel(env: Env, chatId: number, eventId: number, callbackId?: string): BotChannel {
  return {
    platform: 'telegram',
    nativeChatId: chatId,
    eventId,
    getLinkedUserId: () => getLinkedUserId(env, chatId),
    consumeLinkCode: (code) => consumeLinkCode(env, code),
    link: (userId) => linkChat(env, chatId, userId),
    unlink: () => unlinkChat(env, chatId),
    getSelectedWorkspace: () => getSelectedTelegramWorkspace(env, chatId),
    setSelectedWorkspace: (ws) => setSelectedTelegramWorkspace(env, chatId, ws),
    sendText: (text) => sendMessage(env, chatId, text),
    async sendChoices(text, choices) {
      await sendMessageWithButtons(env, chatId, text, choices.map((c) => [{ text: c.label, callback_data: c.id }]));
    },
    async sendArtifactCards(heading, items, userId) {
      await sendMessage(env, chatId, heading);
      for (const item of items) {
        await sendMessageWithButtons(env, chatId, artifactCardText(item), await artifactCardButtons(env, item, userId));
      }
    },
    async answerButton(text) {
      if (callbackId) await answerCallbackQuery(env, callbackId, text);
    },
    replyPort: () => createTelegramReplyPort(env, chatId),
  };
}

async function dispatchUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await dispatchCallback(env, update);
    return;
  }

  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const channel = telegramChannel(env, chatId, update.update_id);

  // Voice notes / audio files carry no .text — transcribe them with Whisper, then
  // route the transcript exactly like a typed message (commands included).
  const audio = msg.voice || msg.audio;
  if (typeof msg.text === 'string') {
    await handleBotText(env, channel, msg.text);
  } else if (audio) {
    const transcript = await handleVoiceMessage(env, chatId, audio);
    if (transcript) await handleBotText(env, channel, transcript);
  }
}

// Resolve a voice/audio message to its transcript, echoing what was heard so the
// user can confirm. Returns null (and replies to the user) on any failure.
async function handleVoiceMessage(
  env: Env,
  chatId: number,
  audio: NonNullable<import('../telegram/types').TelegramMessage['voice']>
): Promise<string | null> {
  const userId = await getLinkedUserId(env, chatId);
  if (!userId) {
    await sendMessage(env, chatId, t('en', BOT_COPY).notLinked(`${getPlatformOrigin(env)}/settings/telegram`));
    return null;
  }
  await sendChatAction(env, chatId, 'typing');
  const selectedWorkspaceId = await getSelectedTelegramWorkspace(env, chatId);
  const result = await transcribeTelegramAudio(env, audio, { userId, selectedWorkspaceId });
  if (result.error || !result.text) {
    await sendMessage(env, chatId, result.error || 'I couldn’t make out that recording.');
    return null;
  }
  await sendMessage(env, chatId, `🎙️ “${result.text}”`);
  return result.text.trim();
}

// An inline-keyboard button tap: an access request (Telegram-only), or the shared bot's
// workspace picker, page-card buttons and approve/cancel of a proposed write.
async function dispatchCallback(env: Env, update: TelegramUpdate): Promise<void> {
  const cq = update.callback_query!;
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;
  if (chatId == null || messageId == null) return;

  const data = cq.data || '';
  if (data.startsWith('ar:')) {
    const userId = await getLinkedUserId(env, chatId);
    if (!userId) {
      await answerCallbackQuery(env, cq.id, 'Connect your account first.');
      return;
    }
    await handleAccessRequestTelegramCallback(env, userId, data, cq.id, chatId, messageId);
    return;
  }

  const channel = telegramChannel(env, chatId, update.update_id, cq.id);
  if (!(await handleBotButton(env, channel, data, { callbackId: cq.id, messageId }))) {
    await answerCallbackQuery(env, cq.id);
  }
}
