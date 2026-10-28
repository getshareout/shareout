// @vitest-environment happy-dom
//
// Artifacts table headers sort: the paged Artifacts lens asks the server for the clicked
// column (A→Z, then Z→A), while the small For you table sorts in place. Runs the whole
// workspace client bundle against the SSR body, like home-boot-fetches.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { componentScripts, tableSortScript } from '../../../src/design-system/components/index';
import { buildWorkspaceView } from '../../../src/pages/home/render-workspace';
import type { RenderArgs } from '../../../src/pages/home/types';

const args = {
  user: { id: 'usr_alice', email: 'alice@example.com' }, userInfo: { name: 'Alice', picture: null },
  workspaces: [{ id: 'wsp_acme', name: 'Acme', slug: 'acme', branding: null }],
  workspace: 'wsp_acme', workspaceId: 'wsp_acme', workspaceRole: 'member', wsKnowledgePaid: true,
  createEnabled: true, locale: null,
} as unknown as RenderArgs;

const row = (name: string, views: number) => `<a class="wsx-tr" data-name="${name}"><span class="wsx-tr__icon"></span><span class="wsx-tr__name">${name}</span>`
  + '<span class="wsx-tr__owner"></span><span class="wsx-tr__shared"></span><span class="wsx-tr__access"></span><span class="wsx-tr__type"></span>'
  + `<span class="wsx-tr__feat"></span><span class="wsx-tr__tags"></span><span class="wsx-tr__views">${views}</span><span class="wsx-tr__visitors"></span>`
  + '<span class="wsx-tr__created"></span><span class="wsx-tr__date"></span></a>';

let urls: string[] = [];
const flush = async (ms = 1000) => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 20; i++) await Promise.resolve(); };
const browserUrls = () => urls.filter((u) => u.startsWith('/v1/home/browser'));
const click = (el: Element | null) => el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

beforeEach(() => {
  vi.useFakeTimers();
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input instanceof Request ? input.url : input).replace(/^https?:\/\/[^/]+/, '');
    urls.push(u);
    const desc = u.includes('dir=desc') && u.includes('sort=name');
    const body = u.startsWith('/v1/home/browser')
      ? { rowsHtml: desc ? row('beta', 1) + row('Alpha', 2) : row('Alpha', 2) + row('beta', 1), cardsHtml: '<div class="artifact-card"></div>', total: 2, page: 1, hasMore: false }
      : u.startsWith('/v1/home/for-you') ? { rowsHtml: row('mid', 10) + row('low', 9) + row('top', 100), cardsHtml: '<div class="artifact-card"></div>', count: 3 } : {};
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
  localStorage.clear();
  localStorage.setItem('wsx_view:wsxArtMount', 'table');
  localStorage.setItem('wsx_view:wsxForYou', 'table');
  const { body, scripts } = buildWorkspaceView(args);
  document.body.innerHTML = body;
  (0, eval)(componentScripts + tableSortScript);
  (0, eval)(scripts);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Artifacts table column sort', () => {
  it('asks the server for the clicked column, A→Z first, then Z→A, and marks the header', async () => {
    await flush();
    click(document.querySelector('[data-lens="artifacts"]'));
    await flush();
    const head = () => document.querySelector('#wsxArtMount .wsx-tbl__head')!;
    expect(head().hasAttribute('data-sort-own')).toBe(true);
    // Opens on All: A→Z with the viewer's favorites first.
    expect(browserUrls().some((u) => u.includes('level=1&sort=name&dir=asc&favfirst=1'))).toBe(true);
    expect(head().querySelector('[data-artsort="name"]')!.getAttribute('aria-sort')).toBe('ascending');

    click(head().querySelector('[data-artsort="name"]'));
    await flush();
    expect(browserUrls().at(-1)).toContain('sort=name&dir=desc');
    expect(browserUrls().at(-1)).not.toContain('favfirst');
    expect([...document.querySelectorAll('#wsxArtMount .wsx-tr')].map((r) => r.getAttribute('data-name'))).toEqual(['beta', 'Alpha']);
    expect(head().querySelector('[data-artsort="name"]')!.getAttribute('aria-sort')).toBe('descending');

    click(head().querySelector('[data-artsort="date"]'));
    await flush();
    expect(browserUrls().at(-1)).toContain('sort=date&dir=asc');
    expect(head().querySelector('[data-artsort="date"]')!.getAttribute('aria-sort')).toBe('ascending');
    expect(head().querySelector('[data-artsort="name"]')!.hasAttribute('aria-sort')).toBe(false);

    click(head().querySelector('[data-artsort="date"]'));
    await flush();
    expect(browserUrls().at(-1)).toContain('sort=date&dir=desc');
    expect(head().querySelector('[data-artsort="date"]')!.getAttribute('aria-sort')).toBe('descending');
  });

  it('sorts the For you table in place', async () => {
    await flush();
    const views = document.querySelector('#wsxForYou .wsx-tbl__head .wsx-tr__views')!;
    expect(views.parentElement!.hasAttribute('data-sort-own')).toBe(false);
    const before = urls.length;
    click(views);
    expect([...document.querySelectorAll('#wsxForYou .wsx-tr')].map((r) => r.getAttribute('data-name'))).toEqual(['low', 'mid', 'top']);
    click(views);
    expect([...document.querySelectorAll('#wsxForYou .wsx-tr')].map((r) => r.getAttribute('data-name'))).toEqual(['top', 'mid', 'low']);
    expect(urls.length).toBe(before);
  });
});
