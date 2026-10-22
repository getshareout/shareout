// @vitest-environment happy-dom
//
// Studio tab row: with 2+ open artifacts the strip takes its own row, and once tabs
// overflow a list button names every open tab (activate / close from the menu).
import { describe, expect, it } from 'vitest';
import { workspace_client_tabs_JS as tabsJs } from '../../../src/pages/home/render-workspace/client-script/tabs';

type Tab = { key: string; label: string; home?: boolean };

function load(open: string[], overflow = false) {
  document.body.innerHTML = '<div class="wsx__chrome"><div id="wsxTabRow"><div id="wsxTabs"></div><button id="wsxTabList" hidden><span></span></button></div></div>'
    + '<div id="wsxPanes"></div><div id="wsxHomePane"></div>';
  const tabsEl = document.getElementById('wsxTabs')!;
  Object.defineProperty(tabsEl, 'scrollWidth', { get: () => (overflow ? 900 : 300) });
  Object.defineProperty(tabsEl, 'clientWidth', { get: () => 300 });
  const calls = { activated: [] as string[], closed: [] as string[] };
  const base: Record<string, unknown> = {
    t: (k: string) => k,
    esc: (s: unknown) => String(s ?? ''),
    isvg: () => '',
    statsCache: {},
    metaCache: {},
    activateTab: (k: string) => calls.activated.push(k),
  };
  const scope = new Proxy({} as Record<string | symbol, unknown>, {
    has: () => true,
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop in base) return base[prop];
      return (globalThis as Record<string, unknown>)[prop];
    },
    set: (target, prop, value) => { target[prop as string] = value; return true; },
  });
  const api = new Function('scope', `with (scope) {\n${tabsJs}\n; return { tabs: tabs, syncTabRow: syncTabRow }; }`)(scope) as {
    tabs: Tab[]; syncTabRow: () => void;
  };
  scope.closeTab = (k: string) => { calls.closed.push(k); api.tabs.splice(api.tabs.findIndex(x => x.key === k), 1); };
  open.forEach(l => api.tabs.push({ key: 'k_' + l, label: l }));
  api.syncTabRow();
  return { ...api, calls, row: document.getElementById('wsxTabRow')!, btn: document.getElementById('wsxTabList') as HTMLButtonElement };
}

describe('tab row', () => {
  it('stays inline with one artifact open, moves to its own row with two', () => {
    expect(load(['A']).row.classList.contains('is-row')).toBe(false);
    expect(load(['A', 'B']).row.classList.contains('is-row')).toBe(true);
  });

  it('shows the list button (with the open count) only when tabs overflow', () => {
    expect(load(['A', 'B']).btn.hidden).toBe(true);
    const { btn } = load(['A', 'B', 'C'], true);
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('3');
  });

  it('lists every artifact tab; picking one activates it, × closes it', () => {
    const { btn, calls } = load(['A', 'B', 'C'], true);
    btn.click();
    const items = document.querySelectorAll('.wsx-tablist [data-tab-go]');
    expect([...items].map(i => i.textContent)).toEqual(['A×', 'B×', 'C×']);
    (document.querySelector('[data-tab-close="k_B"]') as HTMLElement).click();
    expect(calls.closed).toEqual(['k_B']);
    expect(document.querySelectorAll('.wsx-tablist [data-tab-go]').length).toBe(2);
    (document.querySelector('[data-tab-go="k_C"]') as HTMLElement).click();
    expect(calls.activated).toEqual(['k_C']);
    expect(document.querySelector('.wsx-tablist')).toBeNull();
  });

  it('adds a filter once more than 8 artifacts are open', () => {
    const { btn } = load('ABCDEFGHI'.split(''), true);
    btn.click();
    const q = document.querySelector('.wsx-tablist__q') as HTMLInputElement;
    q.value = 'h';
    q.dispatchEvent(new Event('input'));
    const shown = [...document.querySelectorAll('.wsx-tablist [data-tab-go]')].filter(i => !(i as HTMLElement).hidden);
    expect(shown.map(i => i.getAttribute('data-tab-go'))).toEqual(['k_H']);
  });
});
