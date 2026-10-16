// @vitest-environment happy-dom
//
// Instant search: once the index is loaded the palette ranks locally on the first
// keystroke with no request; the deep section fills in later and drops stale answers;
// recent searches are remembered on a pick or Enter, never per keystroke.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_command_palette_JS as paletteJs } from '../../../src/pages/home/render-workspace/client-script/command-palette';
import { workspace_client_search_engine_JS as engineJs } from '../../../src/pages/home/render-workspace/client-script/search-engine';
import { workspace_client_search_store_JS as storeJs } from '../../../src/pages/home/render-workspace/client-script/search-store';
import { SHELL_COPY } from '../../../src/pages/home/home-i18n/copy/shell';
import { SEARCH_COPY } from '../../../src/pages/home/home-i18n/copy/search';

const copy = { ...SHELL_COPY.es, ...SEARCH_COPY.es } as Record<string, string>;
const openArtifact = vi.fn();

const INDEX = {
  v: 1, truncated: false,
  artifacts: [
    ['art_c', 'clasificacion', 'Clasificación de residuos', '', 'fld_ops', 'seguridad', Math.floor(Date.now() / 1000), 'Procedimiento', 0, 0, -1],
    ['art_v', 'ventas', 'Ventas Q3', '', '', '', Math.floor(Date.now() / 1000) - 86400, '', 1, -1, -1],
  ],
  folders: [['fld_ops', 'Operaciones', '', 1]],
  people: [['usr_b', 'Bea Ruiz', 'bea@example.com', '', 'admin']],
  owners: [['Bob', '']],
  workspaces: [],
  recent: ['art_v'],
};

type Call = { url: string; method: string; body?: string; signal?: AbortSignal };
let calls: Call[] = [];
let deepResolvers: Array<{ q: string; resolve: (body: unknown) => void; signal?: AbortSignal }> = [];
let recentServer: { q: string; at: string }[] = [];

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(status === 304 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function fetchMock(input: string, init: RequestInit = {}) {
  const url = String(input);
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ url, method, body: init.body as string | undefined, signal: init.signal ?? undefined });
  if (url.startsWith('/v1/home/search-index')) return Promise.resolve(json(INDEX, 200, { ETag: 'W/"si1"' }));
  if (url.startsWith('/v1/home/deep-search')) {
    const q = new URL(url, 'https://x.test').searchParams.get('q') || '';
    return new Promise<Response>((resolve) => deepResolvers.push({ q, signal: init.signal ?? undefined, resolve: (b) => resolve(json(b)) }));
  }
  if (url.startsWith('/v1/home/recent-searches')) {
    if (method === 'POST') {
      const q = JSON.parse(String(init.body)).q as string;
      recentServer = [{ q, at: new Date().toISOString() }, ...recentServer.filter((r) => r.q.toLowerCase() !== q.toLowerCase())].slice(0, 20);
    }
    if (method === 'DELETE') {
      const q = new URL(url, 'https://x.test').searchParams.get('q');
      recentServer = q == null ? [] : recentServer.filter((r) => r.q !== q);
    }
    return Promise.resolve(json({ searches: recentServer }));
  }
  if (url.startsWith('/v1/home/quick-search')) return Promise.resolve(json({ artifacts: [], folders: [], people: [] }));
  return Promise.resolve(json({}));
}

function boot(uk = 'usr_alice') {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_acme';
  win.WSX_UK = uk;
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string | symbol, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'window') return win;
      if (prop === 't') return (k: string) => copy[k] ?? k;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      if (prop === 'openArtifact') return openArtifact;
      if (prop === 'fetch') return fetchMock;
      if (prop === 'indexedDB' || prop === 'requestIdleCallback') return undefined;
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  new Function('scope', `with (scope) {\n${engineJs}${storeJs}${paletteJs}\n}`)(scope);
  return win.openCommandPalette as () => void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const input = () => document.querySelector<HTMLInputElement>('.wsx-cmdk__input')!;
const rows = () => [...document.querySelectorAll<HTMLElement>('.wsx-cmdk__list [data-pi]')];
const titles = () => rows().map((r) => r.querySelector('.wsx-cmdk__ttl')?.textContent);
function type(q: string) { input().value = q; input().dispatchEvent(new Event('input')); }
function key(k: string) { input().dispatchEvent(new KeyboardEvent('keydown', { key: k })); }
const count = (prefix: string, method = 'GET') => calls.filter((c) => c.url.startsWith(prefix) && c.method === method).length;

beforeEach(() => {
  document.body.innerHTML = '';
  calls = []; deepResolvers = []; recentServer = [];
  openArtifact.mockReset();
  try { localStorage.clear(); } catch { /* storage unavailable */ }
});

async function openWithIndex(uk?: string) {
  boot(uk)();
  await wait(5); // the index request resolves
  expect(count('/v1/home/search-index')).toBeGreaterThan(0);
}

describe('instant section', () => {
  it('renders local matches on the first keystroke, with no server request for them', async () => {
    await openWithIndex();
    type('c');
    // Synchronous: no timer has run yet.
    expect(titles()[0]).toBe('Clasificación de residuos');
    expect(rows()[0].classList.contains('is-sel')).toBe(true);
    type('clasificacion');
    expect(titles()[0]).toBe('Clasificación de residuos');
    // The last ranking's time is left for DevTools (one entry, not one per keystroke).
    expect(performance.getEntriesByName('wsx-search-rank', 'measure')).toHaveLength(1);
    await wait(200);
    expect(count('/v1/home/quick-search')).toBe(0);
    // The deep section is still asked for, separately.
    expect(count('/v1/home/deep-search')).toBe(1);
  });

  it('arrow keys move the highlight and Enter opens it; Esc closes', async () => {
    await openWithIndex();
    type('o');
    const before = titles();
    expect(before.length).toBeGreaterThan(1);
    key('ArrowDown');
    expect(rows()[1].classList.contains('is-sel')).toBe(true);
    key('ArrowUp');
    expect(rows()[0].classList.contains('is-sel')).toBe(true);
    type('ventas');
    key('Enter');
    expect(openArtifact).toHaveBeenCalledWith('ventas', 'Ventas Q3', 'art_v');
    boot()();
    key('Escape');
    expect(document.querySelector('.wsx-cmdk')).toBeNull();
  });

  it('shows recently opened pages for an empty query', async () => {
    await openWithIndex();
    expect(titles()).toContain('Ventas Q3');
  });
});

describe('deep section', () => {
  it('fills in after the debounce and discards a stale answer', async () => {
    await openWithIndex();
    type('cl');
    await wait(170);
    expect(deepResolvers.map((d) => d.q)).toEqual(['cl']);
    type('cla');
    expect(deepResolvers[0].signal?.aborted).toBe(true);
    await wait(170);
    expect(deepResolvers.map((d) => d.q)).toEqual(['cl', 'cla']);
    const content = (id: string, title: string) => ({ content: [{ kind: 'artifact', id, title, slug: id, score: 1 }], passages: [], datasets: [], connectors: [], schedules: [], crew: [], alerts: [], skills: [] });
    deepResolvers[1].resolve(content('art_new', 'Fresh text match'));
    await wait(5);
    deepResolvers[0].resolve(content('art_old', 'Stale text match'));
    await wait(5);
    expect(titles()).toContain('Fresh text match');
    expect(titles()).not.toContain('Stale text match');
    // The instant rows stayed first the whole time.
    expect(titles()[0]).toBe('Clasificación de residuos');
  });
});

describe('recent searches', () => {
  it('are recorded on Enter or a pick, not per keystroke', async () => {
    await openWithIndex();
    for (const q of ['v', 've', 'ven', 'vent', 'venta']) type(q);
    await wait(200);
    expect(count('/v1/home/recent-searches', 'POST')).toBe(0);
    key('Enter');
    expect(count('/v1/home/recent-searches', 'POST')).toBe(1);
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toEqual({ q: 'venta' });

    boot()();
    await wait(5);
    type('clasif');
    rows()[0].click();
    expect(count('/v1/home/recent-searches', 'POST')).toBe(2);
  });

  it('open empty, most recent first; clicking one re-runs it; × removes; Clear empties', async () => {
    await openWithIndex();
    type('ventas'); key('Enter');
    boot()(); await wait(5);
    type('Clasificación'); key('Enter');
    boot()(); await wait(5);
    const recent = () => [...document.querySelectorAll('.wsx-cmdk__item--recent .wsx-cmdk__ttl')].map((e) => e.textContent);
    expect(recent()).toEqual(['Clasificación', 'ventas']);
    // The first row is highlighted, the list is not empty.
    expect(rows()[0].classList.contains('is-sel')).toBe(true);

    (document.querySelector('.wsx-cmdk__item--recent') as HTMLElement).click();
    expect(input().value).toBe('Clasificación');
    expect(titles()[0]).toBe('Clasificación de residuos');

    type('');
    (document.querySelectorAll('.wsx-cmdk__rm')[1] as HTMLElement).click();
    expect(recent()).toEqual(['Clasificación']);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('q=ventas'))).toBe(true);

    (document.querySelector('[data-clear]') as HTMLElement).click();
    expect(recent()).toEqual([]);
    expect(calls.some((c) => c.method === 'DELETE' && !c.url.includes('q='))).toBe(true);
  });

  it('dedupes case/accent-insensitively and caps what it keeps', async () => {
    await openWithIndex();
    for (let i = 0; i < 25; i++) { type(`consulta ${i}`); key('Enter'); key('Escape'); boot()(); }
    type('CONSULTA 24'); key('Enter'); key('Escape');
    boot()(); await wait(5);
    const kept = JSON.parse(localStorage.getItem('wsx_search:usr_alice|wsp_acme')!).rs as { q: string }[];
    expect(kept.length).toBe(20);
    expect(kept[0].q).toBe('CONSULTA 24');
    expect(kept.filter((r) => r.q.toLowerCase() === 'consulta 24')).toHaveLength(1);
    // Up to 8 are shown.
    expect(document.querySelectorAll('.wsx-cmdk__item--recent').length).toBe(8);
  });

  it('are kept per user: another user on the same browser sees none', async () => {
    await openWithIndex('usr_alice');
    type('ventas'); key('Enter');
    recentServer = [];
    document.body.innerHTML = '';
    await openWithIndex('usr_bob');
    expect(document.querySelectorAll('.wsx-cmdk__item--recent').length).toBe(0);
  });

  it('degrade gracefully when storage throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const spySet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      await openWithIndex();
      type('ventas');
      expect(titles()[0]).toBe('Ventas Q3');
      key('Enter');
      expect(openArtifact).toHaveBeenCalled();
    } finally { spy.mockRestore(); spySet.mockRestore(); }
  });
});
