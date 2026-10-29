// The /home document links its static script + styles as cached files instead of
// inlining ~1.3 MB into every response.
import { describe, expect, it } from 'vitest';
import { handleUserHomePage } from '../../../src/pages/home/handler';
import { HOME_SHELL_CSS, HOME_SHELL_JS, homeI18nUrl, homeShellUrls, serveHomeShellAsset } from '../../../src/pages/home/shell-assets';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';
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
    const en = await homeI18nUrl('en');
    expect(html).toContain(`<link rel="stylesheet" href="${css}">`);
    expect(html).toContain(`<link rel="preload" as="script" href="${js}">`);
    expect(html).toContain(`<link rel="preload" as="script" href="${en}">`);
    // Copy file → inline boot globals → shell script, in document order.
    const copyAt = html.indexOf(`<script src="${en}"></script>`);
    expect(copyAt).toBeGreaterThan(0);
    expect(html.indexOf('window.WSX_LOCALE=')).toBeGreaterThan(copyAt);
    expect(html.indexOf(`<script src="${js}"></script>`)).toBeGreaterThan(html.indexOf('window.WSX_LOCALE='));
    expect(html).not.toContain(await homeI18nUrl('es'));
    expect(html).not.toContain(WORKSPACE_STYLES);
    // Perf budget: the document stays under 200 KB.
    expect(new TextEncoder().encode(html).length).toBeLessThan(200_000);
  });

  it('ships one locale: the browser language picks the preloaded + loaded copy file', async () => {
    const res = await handleUserHomePage(new Request('https://x.test/home', { headers: { 'Accept-Language': 'es-AR,es;q=0.9' } }), env, alice);
    const html = await res.text();
    const es = await homeI18nUrl('es');
    expect(html).toContain(`<link rel="preload" as="script" href="${es}">`);
    expect(html).toContain(`<script src="${es}"></script>`);
    expect(html).not.toContain(await homeI18nUrl('en'));
  });

  it('the boot shell carries no copy; each copy file carries exactly one locale', async () => {
    const shell = await (await serveHomeShellAsset(HOME_SHELL_JS, null))!.text();
    const probe = (l: 'en' | 'es') => JSON.stringify(HOME_COPY[l]['meta.title']);
    expect(HOME_COPY.en['meta.title']).not.toBe(HOME_COPY.es['meta.title']);
    expect(shell).not.toContain(probe('en'));
    expect(shell).not.toContain(probe('es'));
    const urls = JSON.parse(shell.match(/window\.WSX_I18N=(\{[^\n]*\});/)![1]) as Record<string, string>;
    for (const [l, other] of [['en', 'es'], ['es', 'en']] as const) {
      expect(urls[l]).toBe(await homeI18nUrl(l));
      const u = new URL(urls[l], 'https://x.test');
      const r = await (await serveSharedBundle(new Request(u), env, u.pathname))!;
      expect(r.headers.get('Cache-Control')).toContain('immutable');
      expect(r.headers.get('Content-Type')).toContain('javascript');
      const body = await r.text();
      expect(body).toContain(probe(l));
      expect(body).not.toContain(probe(other));
      const w = {} as { __SO_HOME_COPY?: Record<string, Record<string, string>> };
      new Function('window', body)(w);
      expect(w.__SO_HOME_COPY).toEqual({ [l]: HOME_COPY[l] });
    }
  });

  it('perf budget: the boot shell script stays under 573 KB (572.2 KB measured; 718 KB with both locales inlined)', async () => {
    const { js } = await homeShellUrls();
    const text = await (await serveHomeShellAsset(HOME_SHELL_JS, new URL(js, 'https://x.test').searchParams.get('v')))!.text();
    // Raised from 566 KB for sortable table headers (Artifacts server sort, Assets column
    // sort): 569.1 KB measured, budget = that + ~0.5%. Raised to 573 KB for the build agent's
    // `step` progress event in the create client (+0.2 KB).
    expect(new TextEncoder().encode(text).length).toBeLessThan(573_000);
    for (const l of ['en', 'es'] as const) {
      const u = new URL(await homeI18nUrl(l), 'https://x.test');
      const copy = await (await serveHomeShellAsset(u.pathname, u.searchParams.get('v')))!.text();
      // Raised from 120 KB for the catalog certification + metrics copy (#223, #234):
      // es measured 120.2 KB, budget = that + ~5%. Follow-up: ship lens copy inside the
      // lazy lens chunks, so lens strings stop counting against every page load.
      expect(new TextEncoder().encode(copy).length, l).toBeLessThan(126_000);
    }
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
