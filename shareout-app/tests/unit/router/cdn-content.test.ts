// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const serveMocks = vi.hoisted(() => ({
  handleServe: vi.fn(),
}));

vi.mock('../../../src/serve', () => serveMocks);

import { handleCdnContent, parseCdnLabel } from '../../../src/router/cdn-content';

const LABEL = '1abc2def3456789012345678';
const HOST = `${LABEL}.shareoutcdn.site`;

function makeEnv(slug: string | null = 'demo'): Env {
  return {
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => (slug ? { slug } : null)),
        })),
      })),
    },
  } as unknown as Env;
}

beforeEach(() => {
  serveMocks.handleServe.mockReset();
  serveMocks.handleServe.mockResolvedValue(new Response('ok', { status: 200 }));
});

afterEach(() => vi.clearAllMocks());

describe('parseCdnLabel', () => {
  it('accepts single-level hex labels', () => {
    expect(parseCdnLabel(HOST)).toBe(LABEL);
  });

  it('rejects reserved, non-hex, multi-level, and foreign hosts', () => {
    expect(parseCdnLabel('www.shareoutcdn.site')).toBeNull();
    expect(parseCdnLabel('my-dashboard.shareoutcdn.site')).toBeNull(); // non-hex
    expect(parseCdnLabel(`a.${HOST}`)).toBeNull(); // multi-level
    expect(parseCdnLabel('shareoutcdn.site')).toBeNull(); // apex
    expect(parseCdnLabel(`${LABEL}.shareout.site`)).toBeNull(); // wrong domain
  });
});

describe('handleCdnContent', () => {
  it('redirects the bare apex to the app', async () => {
    const res = await handleCdnContent(new Request('https://shareoutcdn.site/'), makeEnv());
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://shareout.site/');
  });

  it('404s an invalid content host', async () => {
    const res = await handleCdnContent(new Request('https://www.shareoutcdn.site/'), makeEnv());
    expect(res.status).toBe(404);
  });

  it('404s when the artifact has no production deployment', async () => {
    const res = await handleCdnContent(new Request(`https://${HOST}/`), makeEnv(null));
    expect(res.status).toBe(404);
    expect(serveMocks.handleServe).not.toHaveBeenCalled();
  });

  it('405s non-GET/HEAD methods', async () => {
    const res = await handleCdnContent(new Request(`https://${HOST}/`, { method: 'POST' }), makeEnv());
    expect(res.status).toBe(405);
  });

  it('serves the entrypoint via handleServe with forced raw + contentOrigin and the resolved id', async () => {
    await handleCdnContent(new Request(`https://${HOST}/`), makeEnv());
    expect(serveMocks.handleServe).toHaveBeenCalledTimes(1);
    const [req, , slug, assetPath, opts] = serveMocks.handleServe.mock.calls[0];
    expect(new URL((req as Request).url).searchParams.has('_raw')).toBe(true);
    expect(slug).toBe('demo');
    expect(assetPath).toBe('');
    expect(opts).toMatchObject({ contentOrigin: true, ct: null });
  });

  it('extracts the /c/<ct>/ capability token and the asset path', async () => {
    await handleCdnContent(new Request(`https://${HOST}/c/tok123/app.js`), makeEnv());
    const [, , , assetPath, opts] = serveMocks.handleServe.mock.calls[0];
    expect(assetPath).toBe('app.js');
    expect(opts).toMatchObject({ contentOrigin: true, ct: 'tok123' });
  });

  // Pre-cutover artifacts load shared bundles by same-origin path (e.g.
  // /sdk/shareout.js), which now resolves to <hex>.shareoutcdn.site. These must serve
  // the bundle BEFORE artifact resolution, never fall through to handleServe (404 →
  // "ShareOut is not defined"). One case per content-type the embedded handlers cover
  // without ASSETS; /sdk/shareout.js exercises the ASSETS-backed SDK handler.
  it.each([
    ['/sdk/shareout.js', 'application/javascript'],
    ['/sdk/v1/shareout.js', 'application/javascript'],
    ['/sdk/shareout.css', 'text/css; charset=utf-8'],
    ['/sdk/shareout-ui.js', 'application/javascript; charset=utf-8'],
  ])('serves the shared bundle %s on the content host (not as an artifact asset)', async (path, contentType) => {
    const env = makeEnv();
    (env as unknown as { ASSETS: { fetch: ReturnType<typeof vi.fn> } }).ASSETS = {
      fetch: vi.fn(async () => new Response('var ShareOut={}', { status: 200 })),
    };
    const res = await handleCdnContent(new Request(`https://${HOST}${path}`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(contentType);
    expect(serveMocks.handleServe).not.toHaveBeenCalled();
  });

  it('still routes non-bundle paths to the artifact serve path (bundle check does not swallow assets)', async () => {
    await handleCdnContent(new Request(`https://${HOST}/sdk-data/report.json`), makeEnv());
    expect(serveMocks.handleServe).toHaveBeenCalledTimes(1);
  });

  it('strips any Set-Cookie the serve path might emit (no cookies on the content domain)', async () => {
    serveMocks.handleServe.mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'Set-Cookie': 'shareout_session=leak; Path=/' } }),
    );
    const res = await handleCdnContent(new Request(`https://${HOST}/`), makeEnv());
    expect(res.headers.has('Set-Cookie')).toBe(false);
  });
});
