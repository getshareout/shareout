import { afterEach, describe, expect, it, vi } from 'vitest';
import { shopifyProvider } from '../../../src/data/platform/providers/shopify';
import type { Env } from '../../../src/types';

afterEach(() => vi.unstubAllGlobals());

const SECRET = 'dummy-secret';
const env = { SHOPIFY_CLIENT_ID: 'dummy-id', SHOPIFY_CLIENT_SECRET: SECRET } as unknown as Env;

async function sign(params: Record<string, string>) {
  const msg = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ctx = (params: Record<string, string>) => ({ artifactId: 'art', connectionId: '', callbackUrl: 'https://so.test/cb', state: 's', params, env });

function stubFetch() {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body) });
    return new Response(JSON.stringify({ access_token: 'tok', scope: 'read' }), { status: 200 });
  });
  return calls;
}

describe('f63 shopify oauth shop param', () => {
  it('blocks: crafted shops never trigger a fetch carrying the client secret', async () => {
    const calls = stubFetch();
    for (const shop of ['attacker.example/x?', 'attacker.example#', 'attacker.example/x?a=', 'evil.com', 'a.myshopify.com.evil.com']) {
      const base = { shop, code: 'code', state: 's' };
      await expect(
        shopifyProvider.handleCallback(ctx({ ...base, hmac: await sign(base) }), 'code')
      ).rejects.toThrow();
    }
    expect(calls).toEqual([]);
  });

  it('blocks: getAuthUrl rejects a crafted shop and accepts a real one', async () => {
    await expect(shopifyProvider.getAuthUrl(ctx({ shop: 'attacker.example/x?' }))).rejects.toThrow();
    const url = await shopifyProvider.getAuthUrl(ctx({ shop: 'my-store.myshopify.com' }));
    expect(new URL(url).host).toBe('my-store.myshopify.com');
  });

  it('blocks: a missing or bad hmac is rejected before any fetch', async () => {
    const calls = stubFetch();
    const base = { shop: 'my-store.myshopify.com', code: 'code', state: 's' };
    await expect(shopifyProvider.handleCallback(ctx(base), 'code')).rejects.toThrow();
    await expect(shopifyProvider.handleCallback(ctx({ ...base, hmac: 'a'.repeat(64) }), 'code')).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('a valid shop with a correct hmac still exchanges the code', async () => {
    const calls = stubFetch();
    const base = { shop: 'my-store.myshopify.com', code: 'code', state: 's', timestamp: '1' };
    const res = await shopifyProvider.handleCallback(ctx({ ...base, hmac: await sign(base) }), 'code');
    expect(res.accessToken).toBe('tok');
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['my-store.myshopify.com']);
  });
});
