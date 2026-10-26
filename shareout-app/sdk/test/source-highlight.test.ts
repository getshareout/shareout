// @vitest-environment happy-dom
// The frame half of the viewer's Data sources panel: it answers only the framing
// ShareOut page (window.parent AND the origin that delivered init), outlines what a
// source feeds, and tells its host it shows data without sending anything else.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Mod = typeof import('../src/internal/source-highlight');

const HOST = 'https://shareout.test';
let parent: { postMessage: ReturnType<typeof vi.fn> };
let mod: Mod;
const added: Array<[string, EventListenerOrEventListenerObject]> = [];

const PAGE = `
<script type="shareout/manifest">${JSON.stringify({
  version: '2.0',
  sources: { json: { snapshot: {} } },
  feeds: [{ element: '#chart', source: 'connection:warehouse' }],
})}</script>`;

async function load(head = PAGE, body = '') {
  document.head.innerHTML = head;
  document.body.innerHTML = body;
  vi.resetModules();
  const original = window.addEventListener.bind(window);
  window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: unknown) => {
    added.push([type, fn]);
    return original(type, fn, o as AddEventListenerOptions);
  }) as typeof window.addEventListener;
  try {
    await import('../src/internal/embedded-init');
    mod = await import('../src/internal/source-highlight');
  } finally {
    window.addEventListener = original;
  }
}

function post(data: unknown, origin = HOST, source: unknown = parent) {
  const ev = new MessageEvent('message', { data });
  Object.defineProperty(ev, 'origin', { value: origin });
  Object.defineProperty(ev, 'source', { value: source });
  window.dispatchEvent(ev);
}
const init = (origin = HOST) => post({ type: 'shareout:init', data: { artifactId: 'art_1', baseUrl: HOST } }, origin);
const tick = () => new Promise((r) => setTimeout(r, 0));
const lit = () => Array.from(document.querySelectorAll('.so-src-hl')).map((el) => el.id || el.tagName.toLowerCase());
const sent = () => parent.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type !== 'shareout:ready');

beforeEach(() => {
  parent = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });
});

afterEach(() => {
  for (const [type, fn] of added.splice(0)) window.removeEventListener(type, fn);
  Object.defineProperty(window, 'parent', { value: window, configurable: true });
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('source highlight listener', () => {
  const BODY = `<div id="chart"></div><table id="tbl" data-shareout-source="json:snapshot"></table>
    <span id="kpi" data-shareout-binding="json:snapshot.spend"></span><p id="other"></p>`;

  it('outlines what a source feeds: tags, manifest feeds and the host\'s selectors', async () => {
    await load(PAGE, BODY);
    init();
    await tick();
    post({ type: 'shareout:sources:highlight', ref: 'json:snapshot', selectors: ['[data-shareout-binding="json:snapshot.spend"]'] });
    expect(lit().sort()).toEqual(['kpi', 'tbl']);
    post({ type: 'shareout:sources:highlight', ref: 'connection:warehouse' });
    expect(lit()).toEqual(['chart']);
    expect(document.getElementById('so-src-hl-css')?.textContent).toContain('var(--so-color-primary');
    post({ type: 'shareout:sources:highlight', ref: null });
    expect(lit()).toEqual([]);
  });

  it('ignores every other origin and every other window', async () => {
    await load(PAGE, BODY);
    init();
    await tick();
    post({ type: 'shareout:sources:highlight', ref: 'json:snapshot' }, 'https://evil.test');
    post({ type: 'shareout:sources:highlight', ref: 'json:snapshot' }, 'null');
    post({ type: 'shareout:sources:highlight', ref: 'json:snapshot' }, HOST, window);
    post({ type: 'shareout:sources:highlight', ref: 'json:snapshot' }, HOST, { postMessage: vi.fn() });
    expect(lit()).toEqual([]);
  });

  it('trusts nobody before the host has introduced itself', async () => {
    await load(PAGE, BODY);
    post({ type: 'shareout:sources:highlight', ref: 'json:snapshot' });
    expect(lit()).toEqual([]);
  });

  it('survives hostile input: bad refs, bad selectors, oversized lists', async () => {
    await load(PAGE, BODY);
    init();
    await tick();
    expect(() => post({ type: 'shareout:sources:highlight', ref: 'json:snapshot', selectors: ['::nope(', 42, 'x'.repeat(400), '#kpi'] })).not.toThrow();
    expect(lit().sort()).toEqual(['kpi', 'tbl']);
    post({ type: 'shareout:sources:highlight', ref: '<img onerror=1>', selectors: ['#other'] });
    expect(lit()).toEqual([]);
    const many = Array.from({ length: 150 }, () => '#other');
    expect(mod.highlightSources('json:snapshot', many)).toBe(2);
  });

  it('never answers a highlight request', async () => {
    await load(PAGE, BODY);
    init();
    await tick();
    parent.postMessage.mockClear();
    post({ type: 'shareout:sources:highlight', ref: 'json:snapshot' });
    expect(sent()).toEqual([]);
  });
});

describe('data hint', () => {
  it('tells only the host that delivered init, never "*", and only once', async () => {
    await load(PAGE, '<span data-shareout-binding="json:snapshot.x"></span>');
    expect(sent()).toEqual([]);
    init();
    await tick();
    expect(sent()).toEqual([[{ type: 'shareout:sources:hint' }, HOST]]);
    init();
    await tick();
    expect(sent()).toHaveLength(1);
  });

  it('answers a host ping again', async () => {
    await load(PAGE);
    init();
    await tick();
    post({ type: 'shareout:sources:ping' });
    post({ type: 'shareout:sources:ping' }, 'https://evil.test');
    expect(sent()).toHaveLength(2);
  });

  it('stays quiet on pages without data, until the page reads a data store', async () => {
    await load('', '<h1>Hola</h1>');
    init();
    await tick();
    expect(sent()).toEqual([]);
    mod.noteDataRequest('/comments');
    expect(sent()).toEqual([]);
    mod.noteDataRequest('/json/snapshot');
    expect(sent()).toEqual([[{ type: 'shareout:sources:hint' }, HOST]]);
  });
});

describe('the in-page drawer inside the ShareOut viewer', () => {
  async function mountDrawer() {
    const { SourcesStore } = await import('../src/stores/sources-store');
    return new SourcesStore({} as never).mount();
  }
  const button = () => document.querySelector<HTMLButtonElement>('.so-src-btn')!;

  it('drops its floating button once the host says it shows the sources', async () => {
    await load(PAGE, '<div id="chart"></div>');
    init();
    await tick();
    const ctrl = await mountDrawer();
    expect(button().style.display).toBe('none');
    post({ type: 'shareout:sources:host', panel: true }, 'https://evil.test');
    expect(mod.hostShowsSources()).toBe(false);
    post({ type: 'shareout:sources:host', panel: true });
    expect(mod.hostShowsSources()).toBe(true);
    expect(button().style.display).toBe('none');
    // Badges and the drawer still work from inside the page.
    expect(document.querySelector('#chart .so-src-badge')).not.toBeNull();
    ctrl.open();
    expect(document.getElementById('so-sources-root')!.classList.contains('open')).toBe(true);
    ctrl.destroy();
  });

  it('shows the button when no host speaks up (framed elsewhere)', async () => {
    vi.useFakeTimers();
    try {
      await load(PAGE, '');
      const ctrl = await mountDrawer();
      expect(button().style.display).toBe('none');
      vi.advanceTimersByTime(2600);
      expect(button().style.display).toBe('');
      ctrl.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
