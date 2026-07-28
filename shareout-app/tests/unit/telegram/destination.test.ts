import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { DeliveryContext } from '../../../src/delivery/types';

const getLinkedChatId = vi.hoisted(() => vi.fn());
const sendMessage = vi.hoisted(() => vi.fn());
const sendPhoto = vi.hoisted(() => vi.fn());
const sendDocument = vi.hoisted(() => vi.fn());
const renderArtifactImage = vi.hoisted(() => vi.fn());
const renderArtifactPdf = vi.hoisted(() => vi.fn());

vi.mock('../../../src/telegram/linking', () => ({ getLinkedChatId }));
vi.mock('../../../src/telegram/client', () => ({ sendMessage, sendPhoto, sendDocument }));
vi.mock('../../../src/screenshots', () => ({ renderArtifactImage, renderArtifactPdf }));

import { telegramDestination } from '../../../src/delivery/destinations/telegram';

const ctx: DeliveryContext = { artifactId: 'art_1', createdBy: 'user_1', triggeredVia: 'cron' };
const env = {
  TELEGRAM_BOT_TOKEN: 'tok',
  SHAREOUT_BASE_URL: 'https://shareout.site',
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ name: 'Sales', slug: 'sales' }) }) }) },
} as unknown as Env;

beforeEach(() => {
  [getLinkedChatId, sendMessage, sendPhoto, sendDocument, renderArtifactImage, renderArtifactPdf].forEach((m) => m.mockReset());
  getLinkedChatId.mockResolvedValue(555);
});
afterEach(() => vi.restoreAllMocks());

describe('telegram destination validate', () => {
  it('passes when the creator has a linked chat', async () => {
    expect(await telegramDestination.validate(env, ctx, {})).toBeNull();
  });

  it('errors when there is no linked chat and no chatId', async () => {
    getLinkedChatId.mockResolvedValue(null);
    expect(await telegramDestination.validate(env, ctx, {})).toMatch(/Connect Telegram/i);
  });

  it('rejects a non-numeric chatId', async () => {
    expect(await telegramDestination.validate(env, ctx, { chatId: 'abc' })).toMatch(/numeric/i);
  });
});

describe('telegram destination deliver', () => {
  it('sends a message with the artifact link by default', async () => {
    sendMessage.mockResolvedValue(undefined);
    const res = await telegramDestination.deliver(env, ctx, { customMessage: 'Revenue dropped' });
    expect(res.success).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(env, 555, expect.stringContaining('https://shareout.site/a/sales/'));
    expect(sendMessage.mock.calls[0][2]).toContain('Revenue dropped');
  });

  it('renders + sends a snapshot in snapshot mode', async () => {
    renderArtifactImage.mockResolvedValue(new ArrayBuffer(8));
    sendPhoto.mockResolvedValue(true);
    const res = await telegramDestination.deliver(env, ctx, { mode: 'snapshot' });
    expect(res.success).toBe(true);
    expect(renderArtifactImage).toHaveBeenCalled();
    expect(sendPhoto).toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends a PDF document in pdf mode', async () => {
    renderArtifactPdf.mockResolvedValue(new ArrayBuffer(8));
    sendDocument.mockResolvedValue(true);
    const res = await telegramDestination.deliver(env, ctx, { mode: 'pdf' });
    expect(res.success).toBe(true);
    expect(sendDocument.mock.calls[0][4]).toBe('application/pdf');
  });

  it('delivers to an explicit chatId over the linked chat', async () => {
    sendMessage.mockResolvedValue(undefined);
    await telegramDestination.deliver(env, ctx, { chatId: '999' });
    expect(sendMessage.mock.calls[0][1]).toBe(999);
    expect(getLinkedChatId).not.toHaveBeenCalled();
  });
});
