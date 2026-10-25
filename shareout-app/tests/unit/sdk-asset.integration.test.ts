// Real-runtime check that the SDK bundle is served from the Workers Static Asset
// (public/_bundles/shareout-sdk.js) via the ASSETS binding — workers pool, no node pragma.
import { env } from 'cloudflare:workers';
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

// The paths artifacts load are answered by the assets layer before the Worker runs, with
// headers from public/_headers: same bytes and caching as the fallback route above.
describe('SDK static copies (public/sdk + public/_headers)', () => {
  it.each([
    ['/sdk/shareout.js', false],
    ['/sdk/v1/shareout.js', true],
  ])('%s matches the fallback route', async (path, immutable) => {
    const url = `https://shareout.test${path}`;
    const [res, fallback] = await Promise.all([
      env.ASSETS.fetch(new Request(url)),
      handleServeSDK(new Request(url, { headers: { 'Sec-Fetch-Dest': 'script' } }), env as never, immutable),
    ]);
    expect(res.status).toBe(200);
    for (const h of ['Cache-Control', 'Access-Control-Allow-Origin']) expect(res.headers.get(h)).toBe(fallback.headers.get(h));
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Type')).toMatch(/javascript/);
    expect(await res.text()).toBe(await fallback.text());
  });
});
