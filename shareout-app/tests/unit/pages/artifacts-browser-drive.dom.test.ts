// @vitest-environment happy-dom
//
// All Artifacts, Drive-style: All (the default chip) lists the level's folders first, then
// its artifacts, in one grid; the other chips list every artifact flat. Chips carry workspace
// totals, and pages past the first load with "Load more".
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_artifactsBrowser_JS as BROWSER } from '../../../src/pages/home/render-workspace/client-script/home-views/artifacts-browser';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

const t = (k: string) => HOME_COPY.en[k] ?? k;
const esc = (s: unknown) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'));
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const res = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const card = (n: string) => `<div class="artifact-card" data-name="${n}"></div>`;

let urls: string[];
const TOTALS: Record<string, number> = { recent: 30, favorites: 2, shared: 5, owned: 9 };

function boot() {
  document.body.innerHTML = '<div id="wsx"><div id="home"></div><div id="wsxArtChips">'
    + ['recent', 'all', 'favorites', 'shared', 'mine'].map((f) => `<button class="wsx-chip${f === 'all' ? ' is-on' : ''}" data-art-filter="${f}"><span></span><span class="wsx-chip__n"></span></button>`).join('')
    + '</div><div id="wsxArtMount"></div></div>';
  urls = [];
  const fetchMock = vi.fn((url: string) => {
    urls.push(url);
    const u = new URL(url, 'https://x.test');
    const level = u.searchParams.get('level') === '1';
    const page = Number(u.searchParams.get('page') || 1);
    const sc = u.searchParams.get('scope');
    const scope = !sc || sc === 'all' ? 'recent' : sc;
    if (level) return Promise.resolve(res({ cardsHtml: card('root-art'), rowsHtml: '', foldersHtml: '<article class="wsx-folder-card" data-folder-id="fld_1"></article>', folderRowsHtml: '', total: 1, page: 1, hasMore: false }));
    return Promise.resolve(res({ cardsHtml: card(`${scope}-p${page}`), rowsHtml: '', foldersHtml: '<article class="wsx-folder-card" data-folder-id="fld_1"></article>', total: TOTALS[scope], page, hasMore: scope === 'recent' && page === 1 }));
  });
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_1';
  const ART_DATA: Record<string, { foldersHtml?: string; cardsHtml: string; count: number; folderHead: string; empty: string }> = {};
  const base: Record<string, unknown> = {
    homePane: document.getElementById('home'), ws: document.getElementById('wsx'), t, esc, fetch: fetchMock,
    i18nLoad: () => '', i18nEmpty: (k: string) => k, ART_DATA, requestIdleCallback: () => {},
    renderArtView: (id: string) => { const d = ART_DATA[id]; document.getElementById(id)!.innerHTML = d.folderHead + (d.count ? (d.foldersHtml ? `<div class="wsx-art-folders">${d.foldersHtml}</div>` : '') + (d.cardsHtml ? `<div class="artifacts-grid">${d.cardsHtml}</div>` : '') : d.empty); },
  };
  const scope = new Proxy({} as Record<string | symbol, unknown>, {
    has: () => true,
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop in base) return base[prop];
      if (prop === 'window') return win;
      if (prop === 'document') return document;
      return (globalThis as Record<string, unknown>)[prop];
    },
    set: (target, prop, value) => { target[prop as string] = value; return true; },
  });
  new Function('scope', `with (scope) {\n${BROWSER}\n}`)(scope);
  return win as unknown as { exitFolder: () => void; enterFolder: (id: string, n: string) => void };
}

const grid = () => [...document.querySelectorAll('#wsxArtMount .wsx-art-folders > *, #wsxArtMount .artifacts-grid > *')].map((e) => e.getAttribute('data-name') || e.getAttribute('data-folder-id'));
const chip = (f: string) => document.querySelector(`[data-art-filter="${f}"]`)!;

beforeEach(() => { document.body.innerHTML = ''; });

describe('All Artifacts, Drive-style', () => {
  it('opens on All: the level, folders first, then artifacts, with workspace totals on the chips', async () => {
    const w = boot();
    w.exitFolder(); await settle();
    expect(urls[0]).toContain('level=1');
    expect(grid()).toEqual(['fld_1', 'root-art']);
    expect(['recent', 'all', 'favorites', 'shared', 'mine'].map((f) => chip(f).querySelector('.wsx-chip__n')!.textContent)).toEqual(['30', '30', '2', '5', '9']);
  });

  it('Recent lists every artifact flat', async () => {
    const w = boot();
    w.exitFolder(); await settle();
    (chip('recent') as HTMLButtonElement).click(); await settle();
    expect(grid()).toEqual(['recent-p1']);
  });

  it('Load more appends the next page', async () => {
    const w = boot();
    w.exitFolder(); await settle();
    (chip('recent') as HTMLButtonElement).click(); await settle();
    const more = document.querySelector('.wsx-art-more button') as HTMLButtonElement;
    expect(more.textContent).toBe(t('artifacts.loadMore').replace('{n}', '6'));
    more.click(); await settle();
    expect(grid()).toEqual(['recent-p1', 'recent-p2']);
    expect(document.querySelector('.wsx-art-more')).toBeNull();
  });

  it('asks the server for each chip’s sort, favorites first: All A→Z, Recent by last update', async () => {
    const w = boot();
    w.exitFolder(); await settle();
    expect(urls[0]).toContain('level=1&sort=name&dir=asc&favfirst=1');
    expect(urls.some((u) => u.includes('scope=all&sort=date&dir=desc&favfirst=1'))).toBe(true);
  });

  it('a column header sorts by that column alone, folders still first', async () => {
    const w = boot();
    w.exitFolder(); await settle();
    const h = document.createElement('span'); h.setAttribute('data-artsort', 'date');
    document.getElementById('wsxArtMount')!.appendChild(h);
    h.click(); await settle();
    expect(urls.at(-1)).toContain('level=1&sort=date&dir=asc&workspace=');
    expect(urls.at(-1)).not.toContain('favfirst');
    expect(grid()).toEqual(['fld_1', 'root-art']);
  });

  it('opening a folder switches to All', async () => {
    const w = boot();
    w.exitFolder(); await settle();
    w.enterFolder('fld_1', 'Reports'); await settle();
    expect(chip('all').classList.contains('is-on')).toBe(true);
    expect(chip('recent').classList.contains('is-on')).toBe(false);
    expect(urls.at(-1)).toContain('level=1');
  });
});
