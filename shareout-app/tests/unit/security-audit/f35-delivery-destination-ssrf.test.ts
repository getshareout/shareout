import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { webhookDestination } from '../../../src/delivery/destinations/webhook';
import { httpGetDestination } from '../../../src/delivery/destinations/http-get';
import { discordDestination } from '../../../src/delivery/destinations/discord';
import { slackDestination } from '../../../src/delivery/destinations/slack';

const env = { SHAREOUT_BASE_URL: 'https://shareout.test' } as unknown as Env;
const ctx = { artifactId: 'art_1' } as any;
const bad = ['https://127.0.0.1/x', 'https://localhost./x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://10.0.0.5/x', 'https://shareout.test/health', 'https://a.shareout.test/health'];

afterEach(() => vi.unstubAllGlobals());

describe('f35 delivery destinations SSRF policy', () => {
  it.each(bad)('blocks: validate refuses %s', async (url) => {
    expect(await webhookDestination.validate!(env, ctx, { url } as any)).toMatch(/not allowed/);
    expect(await httpGetDestination.validate!(env, ctx, { url } as any)).toMatch(/not allowed/);
    expect(await discordDestination.validate!(env, ctx, { webhookUrl: url } as any)).toMatch(/not allowed/);
    expect(await slackDestination.validate!(env, ctx, { webhookUrl: url } as any)).toMatch(/not allowed/);
  });

  it('accepts a public https url', async () => {
    expect(await httpGetDestination.validate!(env, ctx, { url: 'https://hooks.example.com/x' } as any)).toBeNull();
    expect(await slackDestination.validate!(env, ctx, { webhookUrl: 'https://hooks.slack.com/services/T/B/X' } as any)).toBeNull();
  });

  it('blocks: a redirect to the metadata address is not followed', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: any) => {
      seen.push(String(u));
      return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest' } });
    }));
    const r = await httpGetDestination.deliver(env, ctx, { url: 'https://public.example.com/x' } as any);
    expect(r.success).toBe(false);
    expect(seen).toEqual(['https://public.example.com/x']);
  });

  it('delivers to a public url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
    expect((await httpGetDestination.deliver(env, ctx, { url: 'https://public.example.com/x' } as any)).success).toBe(true);
  });
});

describe('f35 initial url is checked at delivery time', () => {
  it('blocks: a stored loopback url is never fetched', async () => {
    const f = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', f);
    const r = await httpGetDestination.deliver(env, ctx, { url: 'https://localhost./x' } as any);
    expect(r.success).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
