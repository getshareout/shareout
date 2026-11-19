// Admin → Settings → WhatsApp: any internal member reads the state; only the workspace's
// owners and admins turn it on or off, and only when the instance has a number set up.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(async () => false),
  setWorkspaceFlag: vi.fn(async () => {}),
  countBotLinks: vi.fn(async () => 0),
}));
vi.mock('../../../src/features/flags', async (orig) => ({ ...(await orig<object>()), isFeatureEnabled: h.isFeatureEnabled, setWorkspaceFlag: h.setWorkspaceFlag }));
vi.mock('../../../src/chat-platforms/bot/links', async (orig) => ({ ...(await orig<object>()), countBotLinks: h.countBotLinks }));

import { handleGetWorkspaceWhatsApp, handleSetWorkspaceWhatsApp } from '../../../src/router/api/workspace-whatsapp';
import type { Env } from '../../../src/types';

const READY = { WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '1065' } as Env;
const put = (body: unknown) => new Request('https://x.test', { method: 'PUT', body: JSON.stringify(body) });

beforeEach(() => Object.values(h).forEach((m) => m.mockClear()));

describe('workspace WhatsApp switch', () => {
  it('shows members whether it is on and how to connect, and nobody else', async () => {
    h.isFeatureEnabled.mockResolvedValueOnce(true);
    const res = await handleGetWorkspaceWhatsApp(READY, 'usr_1', 'wsp_a', 'member');
    expect(await res.json()).toEqual({ available: true, enabled: true, linked: false, connect_url: '/settings/whatsapp?go=1' });
    expect(h.isFeatureEnabled).toHaveBeenCalledWith(READY, 'ai.whatsapp_bot', 'wsp_a');
    expect((await handleGetWorkspaceWhatsApp(READY, 'usr_1', 'wsp_a', null)).status).toBe(403);
  });

  it('lets owners and admins turn it on, never members', async () => {
    expect((await handleSetWorkspaceWhatsApp(put({ enabled: true }), READY, 'usr_1', 'wsp_a', 'member')).status).toBe(403);
    expect(h.setWorkspaceFlag).not.toHaveBeenCalled();

    const res = await handleSetWorkspaceWhatsApp(put({ enabled: true }), READY, 'usr_1', 'wsp_a', 'admin');
    expect(res.status).toBe(200);
    expect(h.setWorkspaceFlag).toHaveBeenCalledWith(READY, 'wsp_a', 'ai.whatsapp_bot', true);
  });

  it('refuses a bad body and turning it on where WhatsApp is not set up', async () => {
    expect((await handleSetWorkspaceWhatsApp(put({ enabled: 'yes' }), READY, 'usr_1', 'wsp_a', 'owner')).status).toBe(400);
    expect((await handleSetWorkspaceWhatsApp(put({ enabled: true }), {} as Env, 'usr_1', 'wsp_a', 'owner')).status).toBe(409);
    // Turning it off always works.
    expect((await handleSetWorkspaceWhatsApp(put({ enabled: false }), {} as Env, 'usr_1', 'wsp_a', 'owner')).status).toBe(200);
    expect(h.setWorkspaceFlag).toHaveBeenCalledWith({}, 'wsp_a', 'ai.whatsapp_bot', false);
  });
});
