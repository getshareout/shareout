// @vitest-environment happy-dom
//
// Runtime smoke test for the Admin lens inline client script.
//
// The workspace client script ships as a template-literal STRING assembled into
// one IIFE (see client-script/index.ts). TypeScript never type-checks inside a
// template literal, and until now nothing executed it — so a call like
// `swr('ai', painter)` that forgot its third `fetcher` argument compiled, passed
// `new Function(blob)` (valid syntax), and only blew up at runtime in the browser
// with "fetcher is not a function" when the user opened Admin → AI.
//
// This test executes each Admin tab painter with a stubbed DOM/fetch and asserts
// none of them throw synchronously. Any painter that calls an undefined function
// or violates the swr(key, painter, fetcher) contract fails here, in CI.
import { describe, expect, it } from 'vitest';
import { workspace_client_home_views_admin_JS as adminTs } from '../../../src/pages/home/render-workspace/client-script/home-views/admin';

/** Pull the real tab→painter entry points out of the loadAdmin dispatch map. */
function tabPainterNames(src: string): string[] {
  const map = src.match(/var fn = \{([^}]*)\}\[adminTab\]/);
  if (!map) throw new Error('could not locate loadAdmin dispatch map in admin.ts');
  return [...map[1].matchAll(/:\s*(ad[A-Za-z0-9]+)/g)].map((m) => m[1]);
}

/**
 * Evaluate admin.ts inside a `with(scope)` sandbox so every free identifier
 * (esc, t, i18n*, fetch, window, …) resolves to a safe stub, then return the
 * tab painters as real callables. Functions defined in admin.ts (swr, ad*)
 * resolve locally; only externals hit the proxy.
 */
function loadPainters(names: string[]): Record<string, () => void> {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_test';
  // A callable, self-returning "black hole": ws.querySelectorAll('x').forEach(fn)
  // etc. all no-op. Lets top-level wiring in admin.ts load inertly so we can call
  // the painters directly against the real (happy-dom) document below.
  const blackhole: unknown = new Proxy(function () {}, {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => '' : blackhole),
    apply: () => blackhole,
    construct: () => blackhole as object,
  });
  const scope = new Proxy(
    {},
    {
      has: () => true, // route ALL identifier lookups through the proxy
      get: (_t, prop) => {
        if (typeof prop === 'symbol') return prop === Symbol.unscopables ? undefined : blackhole;
        if (prop === 'window') return win;
        if (prop === 'document') return globalThis.document;
        if (prop === 'needWs') return () => false; // pretend a workspace is selected
        if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s));
        if (prop === 't') return (k: unknown) => String(k);
        if (prop.startsWith('i18n')) return () => '';
        if (prop === 'fetch') return () => new Promise(() => {}); // pending: never resolves
        if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
        return blackhole; // any other helper → inert
      },
    },
  );
  const body = `with (scope) {\n${adminTs}\n; return { ${names
    .map((n) => `${n}: typeof ${n} === 'function' ? ${n} : null`)
    .join(', ')} }; }`;
  return new Function('scope', body)(scope);
}

describe('admin lens client script — runtime smoke', () => {
  const names = tabPainterNames(adminTs);
  const painters = loadPainters(names);

  it('discovers every Admin tab painter', () => {
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const n of names) expect(painters[n], `${n} defined`).toBeTypeOf('function');
  });

  it.each(tabPainterNames(adminTs))('renders %s without throwing', (name) => {
    document.body.innerHTML = '<div id="wsxAdminMount"></div>';
    expect(() => painters[name]()).not.toThrow();
  });
});
