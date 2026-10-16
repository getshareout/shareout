// The /home document links its static script + styles as cached files instead of
// inlining ~1.3 MB into every response.
import { describe, expect, it } from 'vitest';
import { handleUserHomePage } from '../../../src/pages/home/handler';
import { HOME_SHELL_CSS, HOME_SHELL_JS, homeShellUrls, serveHomeShellAsset } from '../../../src/pages/home/shell-assets';
import { serveSharedBundle } from '../../../src/router/shared-bundles';
import { WORKSPACE_CLIENT } from '../../../src/pages/home/render-workspace/client-script';
import { WORKSPACE_STYLES } from '../../../src/pages/home/render-workspace/styles';
import { LAZY_CHUNKS, lazyChunkBody } from '../../../src/pages/home/render-workspace/client-script/lazy-chunks';
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
    // Perf budget: the document stays under 200 KB.
    expect(new TextEncoder().encode(html).length).toBeLessThan(200_000);
  });

  it('perf budget: the boot shell script stays under 720 KB (1,001 KB inlined before the lens split)', async () => {
    const { js } = await homeShellUrls();
    const text = await (await serveHomeShellAsset(HOME_SHELL_JS, new URL(js, 'https://x.test').searchParams.get('v')))!.text();
    expect(new TextEncoder().encode(text).length).toBeLessThan(720_000);
    for (const [name, c] of Object.entries(LAZY_CHUNKS)) expect(text.includes(c.src), `${name} is not in the boot shell`).toBe(false);
  });

  it('lazy lens chunks: the shell names their pinned URLs, served immutable on the /sdk/ rail', async () => {
    const { js } = await homeShellUrls();
    const shell = await (await serveHomeShellAsset(HOME_SHELL_JS, null))!.text();
    const urls = JSON.parse(shell.match(/window\.WSX_CHUNKS=(\{[^\n]*\});/)![1]) as Record<string, string>;
    expect(Object.keys(urls).sort()).toEqual(Object.keys(LAZY_CHUNKS).sort());
    for (const [name, url] of Object.entries(urls)) {
      const u = new URL(url, 'https://x.test');
      const res = await (await serveSharedBundle(new Request(u), env, u.pathname))!;
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toContain('immutable');
      expect(res.headers.get('Content-Type')).toContain('javascript');
      expect(await res.text()).toBe(lazyChunkBody(name));
    }
    // The shell's own hash covers the chunk URLs, so a chunk change re-pins the shell.
    expect(js).toMatch(/\?v=[0-9a-f]{12}$/);
    const unknown = await serveSharedBundle(new Request('https://x.test/sdk/home-lens-nope.js'), env, '/sdk/home-lens-nope.js');
    expect((await unknown!).status).toBe(404);
  });
});
