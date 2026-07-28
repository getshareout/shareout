// Real-runtime check that the SDK bundle is served from the Workers Static Asset
// (public/_bundles/shareout-sdk.js) via the ASSETS binding — workers pool, no node pragma.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handleServeSDK } from '../../src/sdk-serve';

describe('SDK served from static asset (Phase 4)', () => {
  it('serves the real built SDK bundle via env.ASSETS', async () => {
    const res = await handleServeSDK(
      new Request('https://shareout.site/sdk/v1/shareout.js', { headers: { 'Sec-Fetch-Dest': 'script' } }),
      env as never,
      true,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    const body = await res.text();
    expect(body.length).toBeGreaterThan(10_000);
    expect(body).toContain('ShareOut');
  });
});
