import type { Env } from '../../types';
import type { ChatReplyPort } from '../types';
import {
  MAX_MESSAGE_LEN,
  answerCallbackQuery,
  editMessageText,
  sendChatAction,
  sendDocument,
  sendMessage,
  sendMessageWithButtons,
  sendPhoto,
} from '../../telegram/client';
import { artifactCardButtons, artifactCardText, confirmationButtons, openLinkButtons, telegramPlainText } from './format';
import { createTextStream } from '../text-stream';
import { getLinkedUserId } from '../../telegram/linking';
import { telegramLoginLinksEnabled } from '../../telegram/open-link';
import { localeForRecipient, t, type Locale } from '../../i18n';
import { TELEGRAM_LINK_COPY } from './copy';

/** Build a ChatReplyPort backed by the Telegram Bot API for one chat. */
export function createTelegramReplyPort(env: Env, chatId: number): ChatReplyPort {
  // Over-long text can't live in one message: refuse it so the final reply is sent chunked instead.
  const stream = createTextStream({
    post: async (text) => (text.length > MAX_MESSAGE_LEN ? null : sendMessageWithButtons(env, chatId, telegramPlainText(text), [])),
    edit: async (ref, text) => typeof ref === 'number' && text.length <= MAX_MESSAGE_LEN && editMessageText(env, chatId, ref, telegramPlainText(text)),
    send: (text) => sendMessage(env, chatId, telegramPlainText(text)),
  });

  let linked: Promise<{ userId: string; locale: Locale } | null> | null = null;
  const linkedUser = () => (linked ??= getLinkedUserId(env, chatId).then(async (userId) =>
    userId ? { userId, locale: await localeForRecipient(env, { userId }).catch((): Locale => 'en') } : null).catch(() => null));

  /** With one-tap sign-in on, page links in a reply also get login buttons (plain links still work). */
  async function sendOpenButtons(text: string): Promise<void> {
    if (!text || !telegramLoginLinksEnabled(env)) return;
    const who = await linkedUser();
    if (!who) return;
    const rows = await openLinkButtons(env, who.userId, text, who.locale);
    if (rows.length) await sendMessageWithButtons(env, chatId, t(who.locale, TELEGRAM_LINK_COPY).openHeading, rows);
  }

  return {
    async sendText(text) {
      await sendMessage(env, chatId, telegramPlainText(text));
    },

    sendTextDelta: stream.delta,

    async finishText(text) {
      await stream.finish(text);
      await sendOpenButtons(text).catch(() => {});
    },

    async sendTyping() {
      await sendChatAction(env, chatId, 'typing');
    },

    async sendImage(bytes, filename, caption) {
      await sendChatAction(env, chatId, 'upload_photo');
      const ok = await sendPhoto(env, chatId, bytes, filename, caption);
      if (ok) return true;
      return sendDocument(env, chatId, bytes, filename, 'image/png', caption);
    },

    async sendFile(bytes, filename, mime, caption) {
      await sendChatAction(env, chatId, 'upload_document');
      return sendDocument(env, chatId, bytes, filename, mime, caption);
    },

    async sendArtifactCards(items) {
      const who = telegramLoginLinksEnabled(env) ? await linkedUser() : null;
      for (const item of items) {
        await sendMessageWithButtons(env, chatId, artifactCardText(item), await artifactCardButtons(env, item, who?.userId ?? null, who?.locale));
      }
    },

    async askConfirmation(prompt, token) {
      return sendMessageWithButtons(env, chatId, prompt, confirmationButtons(token));
    },

    async answerCallback(callbackId, text) {
      await answerCallbackQuery(env, callbackId, text);
    },

    async editConfirmation(messageRef, prompt) {
      const messageId = typeof messageRef === 'number' ? messageRef : null;
      if (messageId == null) return;
      await editMessageText(env, chatId, messageId, prompt);
    },
  };
}
