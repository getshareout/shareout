// @vitest-environment happy-dom
//
// Rarely used lenses ship as lazy chunks (lazy-chunks.ts): the boot shell carries stubs,
// the first open fetches the chunk and runs the real loader. One shell boot per file:
// a booted shell keeps its window listeners, so a second boot would double-count.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { componentScripts } from '../../../src/design-system/components/index';
import { buildWorkspaceView } from '../../../src/pages/home/render-workspace';
import { LAZY_CHUNKS, lazyChunkBody } from '../../../src/pages/home/render-workspace/client-script/lazy-chunks';
import type { RenderArgs } from '../../../src/pages/home/types';

const args = {
  user: { id: 'usr_alice', email: 'alice@example.com' }, userInfo: { name: 'Alice', picture: null },
  catalog: [], catalogTruncated: false, catalogTotal: 0, allCount: 0, favCount: 0, sharedCount: 0,
  workspaces: [{ id: 'wsp_acme', name: 'Acme', slug: 'acme', branding: null, artifact_count: 0, can_manage: true }],
  folders: [], teamFolders: [], personalFolders: [], filesScope: 'team', folderKind: '', folder: '', tags: [],
  search: '', sort: 'recent', type: '', scope: 'all', workspace: 'wsp_acme', page: 1, openVisDisabled: false,
  workspaceId: 'wsp_acme', workspaceRole: 'admin', wsTeamsPlan: true, wsKnowledgePaid: true, accessRequests: [],
  hostname: 'acme.example.com', visualEditorOffWorkspaces: [], createEnabled: true, locale: null,
} as unknown as RenderArgs;

afterAll(() => { vi.unstubAllGlobals(); });

describe('lazy lens chunks', () => {
  it('fetch nothing at boot, then one chunk per lens on first open', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input instanceof Request ? input.url : input).replace(/^https?:\/\/[^/]+/, '');
      urls.push(u);
      const chunk = u.match(/^\/sdk\/home-lens-([a-z]+)\.js/);
      if (chunk) return new Response(lazyChunkBody(chunk[1]));
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    }));
    const count = (prefix: string) => urls.filter((u) => u.startsWith(prefix)).length;
    const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };
    const { body, scripts } = buildWorkspaceView(args);
    document.body.innerHTML = body;
    (0, eval)(componentScripts);
    (0, eval)(scripts);
    await settle();
    expect(count('/sdk/home-lens-')).toBe(0);

    const open = async (lens: string) => { document.querySelector<HTMLElement>(`[data-lens="${lens}"]`)!.click(); await settle(); };
    await open('catalog');
    expect(count('/sdk/home-lens-catalog.js')).toBe(1);
    // The real loadCatalog ran inside the chunk, in the shell's scope.
    expect(count('/v1/workspaces/wsp_acme/catalog')).toBe(1);
    await open('artifacts');
    await open('catalog');
    expect(count('/sdk/home-lens-catalog.js')).toBe(1);

    await open('admin');
    expect(count('/sdk/home-lens-admin.js')).toBe(1);
    expect(document.getElementById('wsxAdminMount')?.innerHTML).not.toBe('');
    expect(count('/sdk/home-lens-')).toBe(2);
  });

  it('every chunk parses and exports what its shell stubs call', () => {
    const blackhole: unknown = new Proxy(function () {}, { get: (_t, p) => (p === Symbol.toPrimitive ? () => '' : blackhole), apply: () => blackhole });
    for (const [name, c] of Object.entries(LAZY_CHUNKS)) {
      const src = lazyChunkBody(name);
      const local = new Set([...src.matchAll(/^ {2}(?:var|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
      const scope = new Proxy({}, {
        has: (_t, k) => typeof k === 'string' && k !== 'eval' && k !== 'chunkSrc' && !local.has(k),
        get: (_t, k) => (k === Symbol.unscopables ? undefined : blackhole),
      });
      const ex = new Function('scope', 'chunkSrc', 'with (scope) { return eval(chunkSrc); }')(scope, src) as Record<string, unknown>;
      for (const fn of [...c.exports, ...(c.soft ?? [])]) expect(typeof ex[fn], `${name}.${fn}`).toBe('function');
      for (const v of c.vars ?? []) expect(v in ex, `${name}.${v}`).toBe(true);
    }
  });
});
