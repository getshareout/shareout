// The /home document links its static script + styles as cached files instead of
// inlining ~1.3 MB into every response.
import { describe, expect, it } from 'vitest';
import { handleUserHomePage } from '../../../src/pages/home/handler';
import { HOME_SHELL_CSS, HOME_SHELL_JS, homeShellUrls, serveHomeShellAsset } from '../../../src/pages/home/shell-assets';
import { serveSharedBundle } from '../../../src/router/shared-bundles';
import { WORKSPACE_CLIENT } from '../../../src/pages/home/render-workspace/client-script';
import { WORKSPACE_STYLES } from '../../../src/pages/home/render-workspace/styles';
import type { Env } from '../../../src/types';

/** Permissive D1 double: every read comes back empty. */
const emptyDb = {
  prepare: () => ({
    bind: () => ({
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
    }),
  }),
};
const env = { DB: emptyDb, SHAREOUT_BASE_URL: 'https://x.test' } as unknown as Env;
const alice = { id: 'usr_alice', email: 'alice@example.com' };

describe('home shell assets', () => {
  it('serves the current hash as immutable and anything else as the short-TTL alias', async () => {
    const { js, css } = await homeShellUrls();
    const v = new URL(js, 'https://x.test').searchParams.get('v');
    const pinned = await serveHomeShellAsset(HOME_SHELL_JS, v);
    expect(pinned!.headers.get('Cache-Control')).toContain('immutable');
    expect(pinned!.headers.get('Content-Type')).toContain('javascript');
    const text = await pinned!.text();
    expect(text).toContain(WORKSPACE_CLIENT);
    expect(text).toContain('window.WSX_LOCALE');

    const stale = await serveHomeShellAsset(HOME_SHELL_JS, 'deadbeef');
    expect(stale!.headers.get('Cache-Control')).not.toContain('immutable');

    const cssV = new URL(css, 'https://x.test').searchParams.get('v');
    const sheet = await serveHomeShellAsset(HOME_SHELL_CSS, cssV);
    expect(sheet!.headers.get('Content-Type')).toContain('text/css');
    expect(await sheet!.text()).toContain(WORKSPACE_STYLES);
  });

  it('is routed through the shared /sdk/ bundle rail', async () => {
    const { js } = await homeShellUrls();
    const res = await serveSharedBundle(new Request(`https://x.test${js}`), env, HOME_SHELL_JS);
    expect(res).not.toBeNull();
    expect((await res!).status).toBe(200);
  });

  it('the /home document links the assets and stays small', async () => {
    const res = await handleUserHomePage(new Request('https://x.test/home'), env, alice);
    const html = await res.text();
    const { js, css } = await homeShellUrls();
    expect(html).toContain(`<link rel="stylesheet" href="${css}">`);
    expect(html).toContain(`<link rel="preload" as="script" href="${js}">`);
    // The shell script runs after the inline boot globals it reads.
    expect(html.indexOf('window.WSX_LOCALE=')).toBeGreaterThan(0);
    expect(html.indexOf(`<script src="${js}"></script>`)).toBeGreaterThan(html.indexOf('window.WSX_LOCALE='));
    expect(html).not.toContain(WORKSPACE_STYLES);
    expect(html.length).toBeLessThan(200_000);
  });
});
