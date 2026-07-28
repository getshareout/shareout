import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const sendMessage = vi.hoisted(() => vi.fn());
const sendPhoto = vi.hoisted(() => vi.fn());
const sendDocument = vi.hoisted(() => vi.fn());
const sendMessageWithButtons = vi.hoisted(() => vi.fn());

vi.mock('../../../src/telegram/client', () => ({
  sendMessage,
  sendChatAction: vi.fn(),
  sendPhoto,
  sendDocument,
  sendMessageWithButtons,
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
}));

import { createTelegramReplyPort } from '../../../src/chat-platforms/telegram/reply-port';

const env = {} as Env;

describe('createTelegramReplyPort', () => {
  it('falls back to document when photo upload fails', async () => {
    sendPhoto.mockResolvedValue(false);
    sendDocument.mockResolvedValue(true);
    const port = createTelegramReplyPort(env, 99);
    const ok = await port.sendImage(new ArrayBuffer(8), 'x.png', 'cap');
    expect(ok).toBe(true);
    expect(sendPhoto).toHaveBeenCalled();
    expect(sendDocument).toHaveBeenCalled();
  });

  it('returns message id from askConfirmation', async () => {
    sendMessageWithButtons.mockResolvedValue(42);
    const port = createTelegramReplyPort(env, 99);
    const id = await port.askConfirmation('Proceed?', 'tok_1');
    expect(id).toBe(42);
  });
});
