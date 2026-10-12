// Real-runtime: the persisted platform cache lives in the per-artifact MiniDB
// artifact_json (D1 has no artifact_json table).
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { PlatformCache } from '../../../../src/data/platform/core/cache';
import type { Env } from '../../../../src/types';

describe('PlatformCache persisted layer (real MiniDB)', () => {
  it('round-trips a persisted entry across instances and invalidates it', async () => {
    const e = env as unknown as Env;
    const opts = { ttlMs: 60_000, provider: 'shopify', endpoint: 'orders.list', persist: true, userRefreshable: true };
    await new PlatformCache(e, 'art_pc_rt').set('shopify:orders.list:all', { n: 1 }, opts);
    await new PlatformCache(e, 'art_pc_rt').set('shopify:orders.list:all', { n: 2 }, opts);

    const hit = await new PlatformCache(e, 'art_pc_rt').get<{ n: number }>('shopify:orders.list:all');
    expect(hit?.data).toEqual({ n: 2 });

    expect(await new PlatformCache(e, 'art_pc_rt').userRefresh('shopify')).toBe(1);
    expect(await new PlatformCache(e, 'art_pc_rt').get('shopify:orders.list:all')).toBeNull();
  });
});
