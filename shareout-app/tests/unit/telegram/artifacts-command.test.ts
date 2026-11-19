import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const getLinkedUserId = vi.hoisted(() => vi.fn());
const getSelectedTelegramWorkspace = vi.hoisted(() => vi.fn());
const setSelectedTelegramWorkspace = vi.hoisted(() => vi.fn());
const listArtifactsForUser = vi.hoisted(() => vi.fn());
const listWorkspacesForUser = vi.hoisted(() => vi.fn());
const resolveArtifactAccessForUser = vi.hoisted(() => vi.fn());
const sendSnapshotExecute = vi.hoisted(() => vi.fn());
const sendPdfExecute = vi.hoisted(() => vi.fn());
vi.mock('../../../src/telegram/linking', () => ({
  getLinkedUserId,
  getSelectedTelegramWorkspace,
  setSelectedTelegramWorkspace,
  consumeLinkCode: vi.fn(),
  linkChat: vi.fn(),
  unlinkChat: vi.fn(),
}));
vi.mock('../../../src/chat-agent/tools/artifacts', () => ({ listArtifactsForUser }));
vi.mock('../../../src/chat-agent/access', () => ({
  listWorkspacesForUser,
  resolveArtifactAccessForUser,
  TELEGRAM_PERSONAL_WORKSPACE: '__personal',
}));
const isFeatureEnabled = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../src/features/flags', () => ({ isFeatureEnabled }));
vi.mock('../../../src/chat-agent/tools/media', () => ({
  sendSnapshotTool: { execute: sendSnapshotExecute },
  sendPdfTool: { execute: sendPdfExecute },
}));

import { routeTelegram } from '../../../src/router/telegram-router';
import { createFetchContext } from '../../../src/router/context';

const ENV = {
  TELEGRAM_WEBHOOK_SECRET: 'sek',
  TELEGRAM_BOT_TOKEN: 'tok',
  SHAREOUT_BASE_URL: 'https://shareout.site',
} as Env;

function update(text: string) {
  return new Request('https://shareout.site/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sek' },
    body: JSON.stringify({ update_id: 1, message: { chat: { id: 42 }, text } }),
  });
}

function callback(data: string) {
  return new Request('https://shareout.site/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sek' },
    body: JSON.stringify({
      update_id: 2,
      callback_query: {
        id: 'cb_1',
        data,
        message: { message_id: 9, chat: { id: 42 } },
      },
    }),
  });
}

beforeEach(() => {
  getLinkedUserId.mockReset();
  getSelectedTelegramWorkspace.mockReset();
  setSelectedTelegramWorkspace.mockReset();
  listArtifactsForUser.mockReset();
  listWorkspacesForUser.mockReset();
  resolveArtifactAccessForUser.mockReset();
  sendSnapshotExecute.mockReset();
  sendPdfExecute.mockReset();
  isFeatureEnabled.mockReset().mockResolvedValue(true);
  getSelectedTelegramWorkspace.mockResolvedValue(null);
  listWorkspacesForUser.mockResolvedValue([]);
  resolveArtifactAccessForUser.mockResolvedValue({ role: 'viewer' });
  sendSnapshotExecute.mockResolvedValue({ sent: true });
  sendPdfExecute.mockResolvedValue({ sent: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('/artifacts command', () => {
  it('lists the pages of the one workspace it picked, with links', async () => {
    getLinkedUserId.mockResolvedValue('user_1');
    listWorkspacesForUser.mockResolvedValue([
      { id: 'ws_acme', name: 'Acme', slug: 'acme', role: 'owner', artifactCount: 2 },
    ]);
    listArtifactsForUser.mockResolvedValue([
      { id: 'art_sales', name: 'Sales', slug: 'sales', artifact_type: 'html', visibility: 'workspace', updated_at: '2026-06-15' },
      { id: 'art_ops', name: 'Ops', slug: 'ops', artifact_type: 'html', visibility: 'private', updated_at: '2026-06-14' },
    ]);
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await routeTelegram(createFetchContext(update('/artifacts'), ENV));

    // A single eligible workspace is picked for them and remembered.
    expect(setSelectedTelegramWorkspace).toHaveBeenCalledWith(ENV, 42, 'ws_acme');
    expect(listArtifactsForUser).toHaveBeenCalledWith(ENV, 'user_1', { limit: 10, workspaceId: 'ws_acme' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { text: string };
    expect(String(fetchMock.mock.calls[0][0])).toContain('/sendMessage');
    expect(body.text).toContain('Your pages in Acme');
    const card = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      text: string;
      reply_markup: { inline_keyboard: Array<Array<Record<string, string>>> };
    };
    expect(card.text).toContain('Sales');
    expect(card.reply_markup.inline_keyboard[0][0]).toMatchObject({ text: 'Open Page', url: 'https://shareout.site/a/sales/' });
    expect(card.reply_markup.inline_keyboard[1][0]).toMatchObject({ text: 'Snapshot', callback_data: 'snap:art_sales' });
    expect(card.reply_markup.inline_keyboard[2][0]).toMatchObject({ text: 'Ask AI', callback_data: 'ask:art_sales' });
  });

  it('prompts to connect when the chat is not linked', async () => {
    getLinkedUserId.mockResolvedValue(null);
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await routeTelegram(createFetchContext(update('/artifacts'), ENV));

    expect(listArtifactsForUser).not.toHaveBeenCalled();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { text: string };
    expect(body.text).toMatch(/connect your account/i);
  });

  it('switches the current workspace by slug', async () => {
    getLinkedUserId.mockResolvedValue('user_1');
    listWorkspacesForUser.mockResolvedValue([
      { id: 'ws_acme', name: 'Acme', slug: 'acme', role: 'owner', artifactCount: 3 },
    ]);
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await routeTelegram(createFetchContext(update('/workspace acme'), ENV));

    expect(setSelectedTelegramWorkspace).toHaveBeenCalledWith(ENV, 42, 'ws_acme');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { text: string };
    expect(body.text).toContain('work in Acme');
  });

  it('shows workspace picker buttons', async () => {
    getLinkedUserId.mockResolvedValue('user_1');
    listWorkspacesForUser.mockResolvedValue([
      { id: 'ws_acme', name: 'Acme', slug: 'acme', role: 'owner', artifactCount: 3 },
      { id: 'ws_media', name: 'Media', slug: 'media', role: 'member', artifactCount: 2 },
    ]);
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await routeTelegram(createFetchContext(update('/workspaces'), ENV));

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      reply_markup: { inline_keyboard: Array<Array<Record<string, string>>> };
    };
    expect(body.reply_markup.inline_keyboard[0][0]).toMatchObject({ text: 'Acme', callback_data: 'ws:ws_acme' });
    expect(body.reply_markup.inline_keyboard[1][0]).toMatchObject({ text: 'Media', callback_data: 'ws:ws_media' });
    // Always one workspace: no "all pages" or "personal" scope to pick.
    expect(body.reply_markup.inline_keyboard).toHaveLength(2);
  });

  it('runs snapshot from an artifact card callback', async () => {
    getLinkedUserId.mockResolvedValue('user_1');
    const dbFirst = vi.fn(async () => ({
      id: 'art_sales',
      name: 'Sales',
      slug: 'sales',
      visibility: 'workspace',
      artifact_type: 'html',
      updated_at: '2026-06-15',
      created_at: '2026-06-01',
    }));
    const env = {
      ...ENV,
      DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: dbFirst })) })) },
    } as unknown as Env;
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await routeTelegram(createFetchContext(callback('snap:art_sales'), env));

    expect(sendSnapshotExecute).toHaveBeenCalledWith(
      expect.objectContaining({ env, userId: 'user_1', platform: 'telegram', chatId: 42, reply: expect.any(Object) }),
      { artifact_id: 'art_sales' }
    );
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/answerCallbackQuery'))).toBe(true);
  });

  it('only offers workspaces that have the assistant turned on', async () => {
    getLinkedUserId.mockResolvedValue('user_1');
    listWorkspacesForUser.mockResolvedValue([
      { id: 'ws_on', name: 'On', slug: 'on', role: 'member', artifactCount: 1 },
      { id: 'ws_off', name: 'Off', slug: 'off', role: 'member', artifactCount: 1 },
    ]);
    isFeatureEnabled.mockImplementation(async (_env: unknown, _key: unknown, ws: unknown) => ws === 'ws_on');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await routeTelegram(createFetchContext(update('/workspace off'), ENV));

    expect(setSelectedTelegramWorkspace).not.toHaveBeenCalled();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { text: string };
    expect(body.text).toContain('Available workspaces: on');
  });

  it('says the assistant is off when no workspace has it on', async () => {
    getLinkedUserId.mockResolvedValue('user_1');
    listWorkspacesForUser.mockResolvedValue([{ id: 'ws_off', name: 'Off', slug: 'off', role: 'admin', artifactCount: 1 }]);
    isFeatureEnabled.mockResolvedValue(false);
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await routeTelegram(createFetchContext(update('/artifacts'), ENV));

    expect(listArtifactsForUser).not.toHaveBeenCalled();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { text: string };
    expect(body.text).toMatch(/isn’t turned on in your workspace/);
  });
});
