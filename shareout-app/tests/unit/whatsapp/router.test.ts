// The WhatsApp webhook end to end (Meta's payloads in, Graph API calls out): signature,
// linking from a ShareOut account, the one workspace a chat works in, the admin's switch,
// and handing questions to the agent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getBotLinkedUserId: vi.fn(async () => null as string | null),
  consumeBotLinkCode: vi.fn(async () => null as string | null),
  linkBotSession: vi.fn(async () => {}),
  unlinkBotSession: vi.fn(async () => {}),
  getBotSelectedWorkspace: vi.fn(async () => null as string | null),
  setBotSelectedWorkspace: vi.fn(async () => {}),
  listWorkspacesForUser: vi.fn(async () => [] as Array<{ id: string; name: string; slug: string; role: string; artifactCount: number }>),
  isFeatureEnabled: vi.fn(async () => true),
  enqueueAgentTurn: vi.fn(async () => {}),
  enqueueCallback: vi.fn(async () => {}),
  recordAiUsage: vi.fn(async () => {}),
}));

vi.mock('../../../src/chat-platforms/bot/links', async (orig) => ({
  ...(await orig<object>()),
  getBotLinkedUserId: h.getBotLinkedUserId,
  consumeBotLinkCode: h.consumeBotLinkCode,
  linkBotSession: h.linkBotSession,
  unlinkBotSession: h.unlinkBotSession,
  getBotSelectedWorkspace: h.getBotSelectedWorkspace,
  setBotSelectedWorkspace: h.setBotSelectedWorkspace,
}));
vi.mock('../../../src/chat-agent/access', async (orig) => ({ ...(await orig<object>()), listWorkspacesForUser: h.listWorkspacesForUser }));
vi.mock('../../../src/features/flags', async (orig) => ({ ...(await orig<object>()), isFeatureEnabled: h.isFeatureEnabled }));
vi.mock('../../../src/chat-platforms/dispatch', async (orig) => ({ ...(await orig<object>()), enqueueAgentTurn: h.enqueueAgentTurn, enqueueCallback: h.enqueueCallback }));
vi.mock('../../../src/data/ai-usage', async (orig) => ({ ...(await orig<object>()), recordAiUsage: h.recordAiUsage }));

import { routeWhatsApp } from '../../../src/router/whatsapp-router';
import { createFetchContext } from '../../../src/router/context';
import type { Env } from '../../../src/types';

const CODE = '0123456789abcdef0123456789abcdef';
const ENV = {
  WHATSAPP_APP_SECRET: 'app-secret',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  WHATSAPP_ACCESS_TOKEN: 'tok',
  WHATSAPP_PHONE_NUMBER_ID: '1065',
  SHAREOUT_BASE_URL: 'https://shareout.site',
  DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn(async () => ({ email: 'ana@acme.test' })) })) })) },
} as unknown as Env;

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('app-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return 'sha256=' + Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function inbound(message: Record<string, unknown>, phoneNumberId = '1065') {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneNumberId }, messages: [message] } }] }],
  };
}

const text = (body: string) => ({ id: 'wamid.IN1', from: '5491155550000', from_user_id: 'AR.1349', type: 'text', text: { body } });

async function post(payload: unknown, signature?: string): Promise<Response> {
  const body = JSON.stringify(payload);
  const req = new Request('https://shareout.site/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature ?? (await sign(body)) },
    body,
  });
  return (await routeWhatsApp(createFetchContext(req, ENV)))!;
}

let sent: Array<Record<string, any>> = [];
beforeEach(() => {
  Object.values(h).forEach((m) => m.mockClear());
  h.getBotLinkedUserId.mockResolvedValue(null);
  h.consumeBotLinkCode.mockResolvedValue(null);
  h.getBotSelectedWorkspace.mockResolvedValue(null);
  h.listWorkspacesForUser.mockResolvedValue([]);
  h.isFeatureEnabled.mockResolvedValue(true);
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body && typeof init.body === 'string') sent.push(JSON.parse(init.body));
    return Response.json({ messages: [{ id: `wamid.OUT${sent.length}` }] });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('WhatsApp webhook', () => {
  it('answers Meta’s subscribe check only with the verify token', async () => {
    const get = (token: string) => routeWhatsApp(createFetchContext(
      new Request(`https://shareout.site/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=777`), ENV));
    const ok = (await get('verify-me'))!;
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('777');
    expect((await get('wrong'))!.status).toBe(403);
  });

  it('rejects an unsigned or mis-signed call without doing anything', async () => {
    const res = await post(inbound(text('hola')), 'sha256=deadbeef');
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(h.getBotLinkedUserId).not.toHaveBeenCalled();
  });

  it('ignores delivery statuses and another number’s traffic', async () => {
    const statuses = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1065' }, statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }] };
    expect((await post(statuses)).status).toBe(200);
    expect((await post(inbound(text('hola'), '9999'))).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks an unknown number to connect from ShareOut, in Spanish for Argentina, billed to nobody', async () => {
    await post(inbound(text('hola, ¿qué ventas tuvimos?')));
    expect(h.enqueueAgentTurn).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ recipient: 'AR.1349', type: 'text' });
    expect(sent[0].text.body).toContain('Primero conectemos tu cuenta');
    expect(sent[0].text.body).toContain('https://shareout.site/settings/whatsapp');
    expect(h.recordAiUsage).toHaveBeenCalledWith(ENV, expect.objectContaining({ workspaceId: null, kind: 'whatsapp_message' }));
  });

  it('links the chat to the ShareOut account whose one-time code it sends, and settles its workspace', async () => {
    h.consumeBotLinkCode.mockResolvedValue('usr_ana');
    h.listWorkspacesForUser.mockResolvedValue([{ id: 'wsp_acme', name: 'Acme', slug: 'acme', role: 'member', artifactCount: 4 }]);

    await post(inbound(text(`Conectar mi cuenta de ShareOut: ${CODE}`)));

    expect(h.consumeBotLinkCode).toHaveBeenCalledWith(ENV, 'whatsapp', CODE);
    // Keyed by the stable user id; the phone number is kept when they share it.
    expect(h.linkBotSession).toHaveBeenCalledWith(ENV, 'whatsapp', 'AR.1349', 'usr_ana', '5491155550000');
    expect(h.setBotSelectedWorkspace).toHaveBeenCalledWith(ENV, 'whatsapp', 'AR.1349', 'wsp_acme');
    expect(sent.map((m) => m.text?.body).join('\n')).toMatch(/ana@acme\.test[\s\S]*Acme/);
  });

  it('refuses an expired or foreign code', async () => {
    await post(inbound(text(`Conectar mi cuenta de ShareOut: ${CODE}`)));
    expect(h.linkBotSession).not.toHaveBeenCalled();
    expect(sent[0].text.body).toMatch(/venció/);
  });

  it('hands a linked member’s question to the agent inside their workspace', async () => {
    h.getBotLinkedUserId.mockResolvedValue('usr_ana');
    h.getBotSelectedWorkspace.mockResolvedValue('wsp_acme');
    h.listWorkspacesForUser.mockResolvedValue([{ id: 'wsp_acme', name: 'Acme', slug: 'acme', role: 'member', artifactCount: 4 }]);

    await post(inbound(text('¿cómo vienen las ventas?')));

    expect(h.enqueueAgentTurn).toHaveBeenCalledWith(ENV, expect.objectContaining({
      platform: 'whatsapp',
      nativeChatId: 'AR.1349',
      userId: 'usr_ana',
      text: '¿cómo vienen las ventas?',
      selectedWorkspaceId: 'wsp_acme',
      inboundMessageId: 'wamid.IN1',
    }));
    expect(h.isFeatureEnabled).toHaveBeenCalledWith(ENV, 'ai.whatsapp_bot', 'wsp_acme');
  });

  it('does not answer in a workspace whose admin has WhatsApp off', async () => {
    h.getBotLinkedUserId.mockResolvedValue('usr_ana');
    h.getBotSelectedWorkspace.mockResolvedValue('wsp_acme');
    h.listWorkspacesForUser.mockResolvedValue([{ id: 'wsp_acme', name: 'Acme', slug: 'acme', role: 'member', artifactCount: 4 }]);
    h.isFeatureEnabled.mockResolvedValue(false);

    await post(inbound(text('¿cómo vienen las ventas?')));

    expect(h.enqueueAgentTurn).not.toHaveBeenCalled();
    expect(sent[0].text.body).toMatch(/isn’t turned on in your workspace|no está activado en tu espacio/);
  });

  it('asks which workspace when several have it on, then runs the question after the pick', async () => {
    h.getBotLinkedUserId.mockResolvedValue('usr_ana');
    h.listWorkspacesForUser.mockResolvedValue([
      { id: 'wsp_a', name: 'Acme', slug: 'acme', role: 'member', artifactCount: 4 },
      { id: 'wsp_b', name: 'Beta', slug: 'beta', role: 'admin', artifactCount: 2 },
    ]);
    const kv = new Map<string, string>();
    const env = { ...ENV, RATE_LIMIT_KV: {
      get: vi.fn(async (k: string) => kv.get(k) ?? null),
      put: vi.fn(async (k: string, v: string) => { kv.set(k, v); }),
      delete: vi.fn(async (k: string) => { kv.delete(k); }),
    } } as unknown as Env;
    const postEnv = async (payload: unknown) => {
      const body = JSON.stringify(payload);
      return routeWhatsApp(createFetchContext(new Request('https://shareout.site/whatsapp/webhook', {
        method: 'POST', headers: { 'X-Hub-Signature-256': await sign(body) }, body,
      }), env));
    };

    await postEnv(inbound(text('¿cómo vienen las ventas?')));
    expect(h.enqueueAgentTurn).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'interactive', interactive: { type: 'button' } });
    expect(sent[0].interactive.action.buttons.map((b: any) => b.reply.id)).toEqual(['ws:wsp_a', 'ws:wsp_b']);

    h.getBotSelectedWorkspace.mockResolvedValue(null);
    await postEnv(inbound({ id: 'wamid.IN2', from_user_id: 'AR.1349', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'ws:wsp_b', title: 'Beta' } } }));
    expect(h.setBotSelectedWorkspace).toHaveBeenCalledWith(env, 'whatsapp', 'AR.1349', 'wsp_b');
    expect(h.enqueueAgentTurn).toHaveBeenCalledWith(env, expect.objectContaining({ text: '¿cómo vienen las ventas?', selectedWorkspaceId: 'wsp_b' }));
  });

  it('refuses a tapped workspace the person may not chat in', async () => {
    h.getBotLinkedUserId.mockResolvedValue('usr_ana');
    h.listWorkspacesForUser.mockResolvedValue([{ id: 'wsp_a', name: 'Acme', slug: 'acme', role: 'member', artifactCount: 4 }]);
    await post(inbound({ id: 'wamid.IN3', from_user_id: 'AR.1349', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'ws:wsp_other' } } }));
    expect(h.setBotSelectedWorkspace).not.toHaveBeenCalled();
    expect(sent[0].text.body).toMatch(/Workspace not found|No encontré ese espacio/);
  });

  it('routes a confirmation tap to the agent session with the chat’s workspace', async () => {
    h.getBotLinkedUserId.mockResolvedValue('usr_ana');
    h.getBotSelectedWorkspace.mockResolvedValue('wsp_a');
    await post(inbound({ id: 'wamid.IN4', from_user_id: 'AR.1349', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'ok:pa_1' } } }));
    expect(h.enqueueCallback).toHaveBeenCalledWith(ENV, expect.objectContaining({ platform: 'whatsapp', nativeChatId: 'AR.1349', data: 'ok:pa_1', selectedWorkspaceId: 'wsp_a' }));
  });
});
