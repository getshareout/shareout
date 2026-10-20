import { afterEach, describe, expect, it, vi } from 'vitest';
import { shopifyProvider } from '../../../src/data/platform/providers/shopify';
import type { Env } from '../../../src/types';

afterEach(() => vi.unstubAllGlobals());

describe('f63 shopify oauth shop param', () => {
  it('CONFIRMS: handleCallback POSTs SHOPIFY_CLIENT_SECRET to an attacker-chosen host', async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return new Response(JSON.stringify({ access_token: 'tok', scope: 'read' }), { status: 200 });
    });
    const provider = shopifyProvider;
    const env = { SHOPIFY_CLIENT_ID: 'dummy-id', SHOPIFY_CLIENT_SECRET: 'dummy-secret' } as unknown as Env;
    for (const shop of ['attacker.example/x?', 'attacker.example#', 'attacker.example/x?a=']) {
      await provider.handleCallback(
        { artifactId: 'art', connectionId: '', callbackUrl: 'https://so.test/cb', state: 's', params: { shop }, env }, 'code');
    }
    const hosts = calls.map((c) => new URL(c.url).host);
    console.log('HOSTS', JSON.stringify(hosts), JSON.stringify(calls));
    expect(hosts.every((h) => h === 'attacker.example')).toBe(true);
    expect(calls.every((c) => c.body.includes('dummy-secret'))).toBe(true);
  });

  it('CONFIRMS: getAuthUrl also builds a URL on an attacker host', async () => {
    const provider = shopifyProvider;
    const env = { SHOPIFY_CLIENT_ID: 'dummy-id' } as unknown as Env;
    const url = await provider.getAuthUrl({ artifactId: 'a', connectionId: '', callbackUrl: 'https://so.test/cb', state: 's', params: { shop: 'attacker.example/x?' }, env });
    expect(new URL(url).host).toBe('attacker.example');
  });
});
