import { describe, expect, it, vi, afterEach } from 'vitest';
import { chunkText, sendMessage, sendPhoto, sendDocument, sendMessageWithButtons } from '../../../src/telegram/client';
import type { Env } from '../../../src/types';

afterEach(() => vi.unstubAllGlobals());

describe('telegram client', () => {
  it('keeps short text as a single chunk', () => {
    expect(chunkText('hello')).toEqual(['hello']);
  });

  it('splits long text into chunks under the Telegram limit', () => {
    const long = 'x'.repeat(9000);
    const chunks = chunkText(long);
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
    expect(chunks.join('')).toBe(long);
  });

  it('sendMessage posts one request per chunk', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const env = { TELEGRAM_BOT_TOKEN: 'tok' } as Env;

    await sendMessage(env, 123, 'x'.repeat(9000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/bottok/sendMessage');
  });

  it('sendMessage is a no-op without a bot token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await sendMessage({} as Env, 1, 'hi');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendPhoto posts multipart form-data to sendPhoto and returns ok', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const env = { TELEGRAM_BOT_TOKEN: 'tok' } as Env;

    const ok = await sendPhoto(env, 123, new ArrayBuffer(8), 'page.png', 'Revenue');
    expect(ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/bottok/sendPhoto');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('chat_id')).toBe('123');
    expect(form.get('caption')).toBe('Revenue');
    expect(form.get('photo')).toBeInstanceOf(Blob);
  });

  it('sendDocument posts to sendDocument with the given mime and returns ok', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await sendDocument({ TELEGRAM_BOT_TOKEN: 'tok' } as Env, 9, new ArrayBuffer(4), 'page.pdf', 'application/pdf');
    expect(ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/bottok/sendDocument');
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBeInstanceOf(FormData);
  });

  it('sendPhoto returns false (no request) without a bot token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendPhoto({} as Env, 1, new ArrayBuffer(1), 'x.png')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendMessageWithButtons supports URL and callback buttons', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { message_id: 77 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await sendMessageWithButtons({ TELEGRAM_BOT_TOKEN: 'tok' } as Env, 9, 'Sales', [[
      { text: 'Open Page', url: 'https://shareout.site/a/sales/' },
      { text: 'Snapshot', callback_data: 'snap:art_sales' },
    ]]);

    expect(id).toBe(77);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      reply_markup: { inline_keyboard: unknown[][] };
    };
    expect(body.reply_markup.inline_keyboard[0]).toEqual([
      { text: 'Open Page', url: 'https://shareout.site/a/sales/' },
      { text: 'Snapshot', callback_data: 'snap:art_sales' },
    ]);
  });
});
