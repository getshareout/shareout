// WhatsApp building blocks: Meta's price per reply by market, the webhook signature and
// subscribe challenge, text formatting, and the meter every accepted message goes through.
import { afterEach, describe, expect, it, vi } from 'vitest';

const recordAiUsage = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../../src/data/ai-usage', async (orig) => ({ ...(await orig<object>()), recordAiUsage }));

import { whatsappMarket, whatsappServiceMicroUsd } from '../../../src/chat-platforms/whatsapp/rates';
import { verifyWhatsAppSignature, whatsAppSubscribeChallenge } from '../../../src/chat-platforms/whatsapp/verify';
import { artifactListText, whatsappText } from '../../../src/chat-platforms/whatsapp/format';
import { chunkWhatsAppText, sendWhatsAppButtons, sendWhatsAppText } from '../../../src/whatsapp/client';
import { whatsappEventId, whatsappLocaleHint } from '../../../src/router/whatsapp-router';
import type { Env } from '../../../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  recordAiUsage.mockClear();
});

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return 'sha256=' + Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('WhatsApp rates (Meta service messages, USD list, effective 2026-10-01)', () => {
  it('prices a reply by the recipient’s market', () => {
    expect(whatsappServiceMicroUsd('5491155550000')).toBe(26_000); // Argentina
    expect(whatsappServiceMicroUsd('5215555550000')).toBe(8_500); // Mexico
    expect(whatsappServiceMicroUsd('5511999990000')).toBe(6_800); // Brazil
    expect(whatsappServiceMicroUsd('14155550000')).toBe(3_400); // North America
    expect(whatsappServiceMicroUsd('59899123456')).toBe(11_300); // Uruguay → Rest of Latin America
  });

  it('uses the longest calling-code prefix and falls back to Other', () => {
    expect(whatsappMarket('18095550000')).toBe('Rest of Latin America'); // Dominican Republic shares +1
    expect(whatsappMarket('77011234567')).toBe('Kazakhstan'); // shares +7 with Russia
    expect(whatsappMarket('79161234567')).toBe('Russia');
    expect(whatsappMarket('6761234567')).toBe('Other'); // Tonga is not on the card
    expect(whatsappServiceMicroUsd('6761234567')).toBe(7_700);
  });

  it('reads the country of a username user from their business-scoped id', () => {
    expect(whatsappMarket('AR.13491208655302741918')).toBe('Argentina');
    expect(whatsappMarket('UY.1')).toBe('Rest of Latin America');
    expect(whatsappMarket('ZZ.1')).toBe('Other');
  });
});

describe('WhatsApp webhook auth', () => {
  const env = { WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_VERIFY_TOKEN: 'verify-me' } as Env;

  it('accepts only bodies signed with the app secret', async () => {
    const body = '{"object":"whatsapp_business_account"}';
    expect(await verifyWhatsAppSignature(env, body, await sign('app-secret', body))).toBe(true);
    expect(await verifyWhatsAppSignature(env, body + ' ', await sign('app-secret', body))).toBe(false);
    expect(await verifyWhatsAppSignature(env, body, await sign('other', body))).toBe(false);
    expect(await verifyWhatsAppSignature(env, body, null)).toBe(false);
    // No app secret configured: nothing is trusted, whatever the header says.
    expect(await verifyWhatsAppSignature({} as Env, body, await sign('app-secret', body))).toBe(false);
  });

  it('echoes the subscribe challenge only for the right verify token', () => {
    const url = (token: string) => new URL(`https://x.test/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=42`);
    expect(whatsAppSubscribeChallenge(env, url('verify-me'))).toBe('42');
    expect(whatsAppSubscribeChallenge(env, url('nope'))).toBeNull();
    expect(whatsAppSubscribeChallenge({} as Env, url('verify-me'))).toBeNull();
  });
});

describe('WhatsApp formatting', () => {
  it('turns the model’s Markdown into what WhatsApp shows', () => {
    expect(whatsappText('## Sales\n**Up** 12% — [Dashboard](https://x.test/a/s/) and <https://x.test/b>'))
      .toBe('*Sales*\n*Up* 12% — Dashboard: https://x.test/a/s/ and https://x.test/b');
  });

  it('lists pages in one message, each with its link', () => {
    const text = artifactListText('Your pages in Acme:', [{ id: 'a', name: 'Sales', slug: 'sales' }, { id: 'b', name: '', slug: 'ops' }], (s) => `https://x.test/a/${s}/`);
    expect(text).toBe('Your pages in Acme:\n\n1. Sales\nhttps://x.test/a/sales/\n2. ops\nhttps://x.test/a/ops/');
  });

  it('chunks long text under the 4096-character limit', () => {
    const chunks = chunkWhatsAppText(('a'.repeat(100) + '\n').repeat(90));
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 4000)).toBe(true);
  });

  it('greets in Spanish where Spanish is spoken, before the account is known', () => {
    expect(whatsappLocaleHint('AR.1')).toBe('es');
    expect(whatsappLocaleHint('5491155550000')).toBe('es');
    expect(whatsappLocaleHint('US.1')).toBe('en');
    expect(whatsappLocaleHint('14155550000')).toBe('en');
  });

  it('derives a stable numeric dedup id from a message id', async () => {
    const a = await whatsappEventId('wamid.ABC');
    expect(a).toBe(await whatsappEventId('wamid.ABC'));
    expect(a).not.toBe(await whatsappEventId('wamid.ABD'));
    expect(Number.isSafeInteger(a)).toBe(true);
  });
});

describe('WhatsApp sending and metering', () => {
  const env = { WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '1065' } as Env;

  it('meters every accepted message against the chat’s workspace at its market price', async () => {
    const fetchMock = vi.fn(async () => Response.json({ messages: [{ id: 'wamid.out1' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const id = await sendWhatsAppText(env, { to: 'AR.1349', meter: { workspaceId: 'wsp_a', userId: 'usr_1' } }, 'Hola');

    expect(id).toBe('wamid.out1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v27.0/1065/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    // A username user is addressed by their business-scoped id.
    expect(JSON.parse(init.body as string)).toMatchObject({ messaging_product: 'whatsapp', recipient: 'AR.1349', type: 'text', text: { body: 'Hola' } });
    expect(recordAiUsage).toHaveBeenCalledWith(env, expect.objectContaining({
      workspaceId: 'wsp_a', userId: 'usr_1', kind: 'whatsapp_message', units: 1, unitKind: 'messages',
      baseCostMicroUsd: 26_000, source: 'whatsapp', providerRef: 'wamid.out1',
    }));
  });

  it('meters nothing when Meta refuses the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 131047, message: 'Re-engagement message' } }, { status: 400 })));
    expect(await sendWhatsAppText(env, { to: '5491155550000', meter: { workspaceId: 'wsp_a', userId: 'usr_1' } }, 'Hola')).toBeNull();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it('sends nothing when WhatsApp is not set up', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendWhatsAppText({} as Env, { to: '5491155550000', meter: { workspaceId: null, userId: null } }, 'Hola')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps reply buttons within Meta’s limits (3 buttons, 20-character titles)', async () => {
    const fetchMock = vi.fn(async () => Response.json({ messages: [{ id: 'wamid.b' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await sendWhatsAppButtons(env, { to: '5491155550000', meter: { workspaceId: 'wsp_a', userId: null } }, 'Pick one', [
      { id: 'ws:1', title: 'A very long workspace name indeed' }, { id: 'ws:2', title: 'B' }, { id: 'ws:3', title: 'C' }, { id: 'ws:4', title: 'D' },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.to).toBe('5491155550000');
    expect(body.interactive.action.buttons).toHaveLength(3);
    expect(body.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
  });
});
