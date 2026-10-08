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
  MAX_MESSAGE_LEN: 4000,
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

describe('createTelegramReplyPort streaming', () => {
  it('posts a placeholder, then settles it with editMessageText', async () => {
    const client = await import('../../../src/telegram/client');
    sendMessageWithButtons.mockResolvedValue(7);
    vi.mocked(client.editMessageText).mockResolvedValue(true);
    sendMessage.mockClear();
    const port = createTelegramReplyPort(env, 99);
    await port.sendTextDelta!('Checking');
    expect(sendMessageWithButtons).toHaveBeenCalledWith(env, 99, 'Checking', []);
    await port.finishText!('Here you go.');
    expect(client.editMessageText).toHaveBeenCalledWith(env, 99, 7, 'Here you go.');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends an over-long final reply as chunked messages instead of editing', async () => {
    const client = await import('../../../src/telegram/client');
    sendMessageWithButtons.mockResolvedValue(8);
    vi.mocked(client.editMessageText).mockClear();
    sendMessage.mockClear();
    const port = createTelegramReplyPort(env, 99);
    await port.sendTextDelta!('Start');
    const long = 'x'.repeat(5000);
    await port.finishText!(long);
    expect(client.editMessageText).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(env, 99, long);
  });
});
