import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTelegram } from '../../../src/router/telegram-router';
import { createFetchContext } from '../../../src/router/context';
import type { Env } from '../../../src/types';

const getLinkedUserId = vi.hoisted(() => vi.fn(async () => null as string | null));
const sendMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const unlinkChat = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const setSelectedTelegramWorkspace = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getSelectedTelegramWorkspace = vi.hoisted(() => vi.fn(async () => null));
const enqueueAgentTurn = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../src/telegram/linking', () => ({
  consumeLinkCode: vi.fn(),
  linkChat: vi.fn(),
  getLinkedUserId,
  getSelectedTelegramWorkspace,
  setSelectedTelegramWorkspace,
  unlinkChat,
}));

vi.mock('../../../src/telegram/client', () => ({
  sendMessage,
  sendMessageWithButtons: vi.fn(),
  answerCallbackQuery: vi.fn(),
  sendChatAction: vi.fn(),
}));

vi.mock('../../../src/chat-platforms/dispatch', () => ({
  enqueueAgentTurn,
  enqueueCallback: vi.fn(),
}));

vi.mock('../../../src/support/intake', () => ({
  openTicket: vi.fn().mockResolvedValue({ id: 't1' }),
}));

afterEach(() => vi.unstubAllGlobals());

function webhookRequest(body: unknown, secret?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== undefined) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  return new Request('https://shareout.site/telegram/webhook', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function messageUpdate(text: string, chatId = 42) {
  return {
    update_id: 99,
    message: { message_id: 1, chat: { id: chatId }, text, date: 1 },
  };
}

const ENV = {
  TELEGRAM_WEBHOOK_SECRET: 'sek',
  TELEGRAM_BOT_TOKEN: 'tok',
  SHAREOUT_BASE_URL: 'https://shareout.site',
} as Env;

beforeEach(() => {
  getLinkedUserId.mockReset().mockResolvedValue(null);
  sendMessage.mockReset().mockResolvedValue(undefined);
  unlinkChat.mockReset().mockResolvedValue(undefined);
  setSelectedTelegramWorkspace.mockReset().mockResolvedValue(undefined);
  getSelectedTelegramWorkspace.mockReset().mockResolvedValue(null);
  enqueueAgentTurn.mockReset().mockResolvedValue(undefined);
});

describe('telegram webhook router', () => {
  it('returns 200 and ignores a wrong secret without side effects', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ctx = createFetchContext(webhookRequest({ update_id: 1 }, 'wrong'), ENV);
    const res = await routeTelegram(ctx);
    expect(res!.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 200 when no webhook secret is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ctx = createFetchContext(webhookRequest({ update_id: 1 }, 'anything'), {} as Env);
    const res = await routeTelegram(ctx);
    expect(res!.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 200 on a valid update with no message (nothing to do)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ctx = createFetchContext(webhookRequest({ update_id: 2 }, 'sek'), ENV);
    const res = await routeTelegram(ctx);
    expect(res!.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 200 on malformed JSON with a valid secret', async () => {
    const ctx = createFetchContext(webhookRequest('{not json', 'sek'), ENV);
    const res = await routeTelegram(ctx);
    expect(res!.status).toBe(200);
  });

  it('does not match non-webhook telegram paths', async () => {
    const ctx = createFetchContext(new Request('https://shareout.site/telegram/other'), ENV);
    expect(await routeTelegram(ctx)).toBeNull();
  });

  it('handles /help without a linked account', async () => {
    const res = await routeTelegram(createFetchContext(webhookRequest(messageUpdate('/help'), 'sek'), ENV));
    expect(res!.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(ENV, 42, expect.stringContaining('ShareOut assistant'));
  });

  it('prompts unlinked users on free text', async () => {
    const res = await routeTelegram(
      createFetchContext(webhookRequest(messageUpdate('summarize my report'), 'sek'), ENV),
    );
    expect(res!.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(ENV, 42, expect.stringMatching(/connect your account/i));
    expect(enqueueAgentTurn).not.toHaveBeenCalled();
  });

  it('handles linked /personal, unknown command, /unlink', async () => {
    getLinkedUserId.mockResolvedValue('usr_1');

    await routeTelegram(createFetchContext(webhookRequest(messageUpdate('/personal'), 'sek'), ENV));
    expect(setSelectedTelegramWorkspace).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(ENV, 42, expect.stringMatching(/personal pages/i));

    await routeTelegram(createFetchContext(webhookRequest(messageUpdate('/notacommand'), 'sek'), ENV));
    expect(sendMessage).toHaveBeenCalledWith(ENV, 42, expect.stringMatching(/don.?t know/i));

    await routeTelegram(createFetchContext(webhookRequest(messageUpdate('/unlink'), 'sek'), ENV));
    expect(unlinkChat).toHaveBeenCalledWith(ENV, 42);
  });

  it('handles /start without a code', async () => {
    await routeTelegram(createFetchContext(webhookRequest(messageUpdate('/start'), 'sek'), ENV));
    expect(sendMessage).toHaveBeenCalledWith(ENV, 42, expect.stringMatching(/Connect your account|Welcome/i));
  });
});
