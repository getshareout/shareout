// @vitest-environment happy-dom
//
// The compact Home: greeting and the line under it, Needs you (fresh items only, each with its
// action), In your workspace, Your artifacts tabs as small tiles (Favorites asks the server once,
// on first open), This week from the analytics endpoint, What's new from the release notes, and
// the ask box sending into the chat. One shell boot for the file.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { componentScripts } from '../../../src/design-system/components/index';
import { buildWorkspaceView } from '../../../src/pages/home/render-workspace';
import { lazyChunkBody } from '../../../src/pages/home/render-workspace/client-script/lazy-chunks';
import { WHATS_NEW } from '../../../src/pages/home/whats-new-data';
import type { RenderArgs } from '../../../src/pages/home/types';

const args = {
  user: { id: 'usr_ana', email: 'ana@example.com' }, userInfo: { name: 'Ana Ruiz', picture: null },
  workspaces: [{ id: 'wsp_acme', name: 'Acme', slug: 'acme', branding: null }],
  workspace: 'wsp_acme', workspaceId: 'wsp_acme', workspaceRole: 'member', wsKnowledgePaid: true,
  createEnabled: true, locale: null,
} as unknown as RenderArgs;

const nowS = () => Math.floor(Date.now() / 1000);
const mini = (id: string, name: string) => `<a class="wsx-mini" href="/a/${id}/" data-id="${id}" data-name="${name}"><span class="wsx-mini__th"></span><span class="wsx-mini__main"><span class="wsx-mini__t">${name}</span><span class="wsx-mini__s"><span data-ts="${new Date(Date.now() - 3 * 3600_000).toISOString()}"></span></span></span></a>`;
const feed = {
  needs: [
    { id: 'ev1', kind: 'comment', actor: 'Martín', artifact_id: 'art_1', artifact_name: 'Weekly summary', slug: 'weekly', summary: 'Add the margin column?', ts: nowS() - 3600 },
    { id: 'ev2', kind: 'access', actor: 'Old request', artifact_id: 'art_2', artifact_name: 'Q4 sales', slug: 'q4', summary: 'wants to edit', ts: nowS() - 30 * 86400 },
  ],
  pulse: [{ id: 'run:art_3', kind: 'run', artifact_id: 'art_3', artifact_name: 'Daily sales', slug: 'daily', summary: '124 new rows', count: 1, ts: nowS() - 600 }],
};
const week = {
  range: 7, totals: { views: 142, uniques: 18, activeArtifacts: 4 }, prev: { views: 120, uniques: 11 },
  series: [{ date: new Date().toISOString().slice(0, 10), views: 9, uniques: 4 }],
  topArtifacts: [{ artifact_id: 'art_3', name: 'Daily sales', slug: 'daily', views: 61, uniques: 9, lastViewed: '' }],
};

const urls: string[] = [];
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
function route(url: string): Response {
  const chunk = url.match(/^\/sdk\/home-lens-([a-z]+)\.js/);
  if (chunk) return new Response(lazyChunkBody(chunk[1]!));
  if (url.startsWith('/v1/home/activity-feed')) return json(feed);
  if (url.startsWith('/v1/home/recent?')) return json({ items: [{ id: 'art_3', slug: 'daily', name: 'Daily sales', ts: null }], miniHtml: mini('daily', 'Daily sales') + mini('stock', 'Stock by branch'), rowsHtml: '', count: 2 });
  if (url.startsWith('/v1/home/for-you')) return json({ miniHtml: mini('plan', 'Q1 plan'), rowsHtml: '', cardsHtml: '', count: 1, ids: ['plan'] });
  if (url.startsWith('/v1/home/browser') && url.includes('scope=favorites')) return json({ miniHtml: mini('fav', 'Pinned board'), rowsHtml: '', total: 1 });
  if (url.startsWith('/v1/home/analytics')) return json(week);
  return json({});
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0)); };
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const count = (prefix: string) => urls.filter((u) => u.startsWith(prefix)).length;

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input).replace(/^https?:\/\/[^/]+/, '');
    urls.push(url);
    return route(url);
  }));
  localStorage.clear();
  const { body, scripts } = buildWorkspaceView(args);
  document.body.innerHTML = body;
  (0, eval)(componentScripts);
  (0, eval)(scripts);
  await settle();
  await new Promise((r) => setTimeout(r, 450)); // This week loads once the page is idle
  await settle();
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('compact Home', () => {
  it('greets by first name and says how many things wait', () => {
    expect($('#wsxHello')!.textContent).toMatch(/^Good (morning|afternoon|evening), Ana$/);
    expect($('#wsxNarration')!.textContent).toContain('1 thing needs you');
  });

  it('Needs you shows fresh items only, each with the action it asks for', () => {
    const rows = [...document.querySelectorAll('#wsxNeedsYou .wsx-ev')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-name')).toBe('Weekly summary');
    expect(rows[0]!.querySelector('.wsx-ev__go')!.textContent).toBe('Reply');
    expect($('#wsxNeedsN')!.hidden).toBe(false);
    expect($('#wsxNeedsN')!.textContent).toBe('1');
  });

  it('In your workspace lists the feed updates', () => {
    expect(document.querySelectorAll('#wsxPulse .wsx-ev')).toHaveLength(1);
    expect($('#wsxPulse')!.textContent).toContain('124 new rows');
  });

  it('Your artifacts opens on Recent as small tiles, with their time filled in', () => {
    expect($('#wsxRecentArts')!.hidden).toBe(false);
    const tiles = document.querySelectorAll('#wsxRecentArts .wsx-mini');
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.querySelector('[data-ts]')!.textContent).toMatch(/^3\s?h$/);
    expect(document.querySelectorAll('#wsxForYou .wsx-mini')).toHaveLength(1);
  });

  it('Favorites asks the server for small tiles once, on first open', async () => {
    $<HTMLButtonElement>('[data-arts-tab="favorites"]')!.click();
    await settle();
    expect(count('/v1/home/browser?scope=favorites&mini=1')).toBe(1);
    expect($('#wsxFavArts')!.hidden).toBe(false);
    expect($('#wsxRecentArts')!.hidden).toBe(true);
    expect($('#wsxFavArts')!.textContent).toContain('Pinned board');
    $<HTMLButtonElement>('[data-arts-tab="recent"]')!.click();
    $<HTMLButtonElement>('[data-arts-tab="favorites"]')!.click();
    await settle();
    expect(count('/v1/home/browser?scope=favorites&mini=1')).toBe(1);
  });

  it('This week shows the views of your artifacts against last week', () => {
    expect(count('/v1/home/analytics?range=7')).toBe(1);
    const w = $('#wsxWeek')!.textContent!;
    expect(w).toContain('142');
    expect(w).toContain('+18%');
    expect(w).toContain('Daily sales');
  });

  it("What's new lists the latest release notes, each linked to its entry", () => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('#wsxNews .wsx-news')];
    expect(links).toHaveLength(WHATS_NEW.length);
    expect(links[0]!.getAttribute('href')).toBe(`https://docs.shareout.site/whats-new/#${WHATS_NEW[0]!.anchor}`);
    expect(links[0]!.textContent).toContain(WHATS_NEW[0]!.en);
  });

  it('the ask box sends into the chat and clears', async () => {
    const inp = $<HTMLInputElement>('#wsxHeroAsk')!;
    inp.value = 'Which artifact got the most views?';
    $<HTMLFormElement>('#wsxHero')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(inp.value).toBe('');
    expect($('#wsxComposer')!.getAttribute('data-state')).toBe('sheet');
    expect($('#wsxThreadList')!.textContent).toContain('Which artifact got the most views?');
  });
});
