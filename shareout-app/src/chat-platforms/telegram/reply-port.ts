import type { Env } from '../../types';
import type { ArtifactCardItem, ChatReplyPort } from '../types';
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
import { artifactCardButtons, artifactCardText, confirmationButtons } from './format';
import { createTextStream } from '../text-stream';

/** Build a ChatReplyPort backed by the Telegram Bot API for one chat. */
export function createTelegramReplyPort(env: Env, chatId: number): ChatReplyPort {
  // Over-long text can't live in one message: refuse it so the final reply is sent chunked instead.
  const stream = createTextStream({
    post: async (text) => (text.length > MAX_MESSAGE_LEN ? null : sendMessageWithButtons(env, chatId, text, [])),
    edit: async (ref, text) => typeof ref === 'number' && text.length <= MAX_MESSAGE_LEN && editMessageText(env, chatId, ref, text),
    send: (text) => sendMessage(env, chatId, text),
  });

  return {
    async sendText(text) {
      await sendMessage(env, chatId, text);
    },

    sendTextDelta: stream.delta,

    finishText: stream.finish,

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
      for (const item of items) {
        await sendMessageWithButtons(env, chatId, artifactCardText(item), artifactCardButtons(env, item));
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
