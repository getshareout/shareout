// @vitest-environment happy-dom
//
// Studio "watch it build": Create with AI opens a live tab on the first streamed chunk,
// repaints a scripts-only srcdoc preview at most every 250 ms, swaps in the published
// artifact in the same slot when done, offers Try again on failure, never persists the
// live tab, and aborts the request when that tab is closed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_tabs_JS as tabsJs } from '../../../src/pages/home/render-workspace/client-script/tabs';
import { workspace_client_inspector_JS as inspectorJs } from '../../../src/pages/home/render-workspace/client-script/inspector';
import { workspace_client_create_ai_JS as createJs } from '../../../src/pages/home/render-workspace/client-script/create-ai';
import { COMPOSER_COPY } from '../../../src/pages/home/home-i18n/copy/composer';

type Ev = Record<string, unknown>;
type Stream = { emit: (ev: Ev) => void; end: () => void; signal: AbortSignal };
type TabEntry = { key: string; label: string; home?: boolean; live?: boolean };

const LS_KEY = 'wsx_tabs_test';

function load() {
  document.body.innerHTML = '<div class="wsx" id="ws">'
    + '<div id="wsxTabs"></div><div id="wsxPanes"></div><div id="wsxHomePane" class="is-active"></div>'
    + '<div id="wsxTabMode" hidden><button data-mode="view"></button><button data-mode="edit"></button></div>'
    + '<button id="wsxTabDevice"></button><button id="wsxTabFull"></button>'
    + '<div id="wsxRtabs"></div><div id="wsxRbody"></div>'
    + '<div id="wsxComposer" data-state="sheet"><textarea id="wsxAsk"></textarea><div id="wsxThreadList"></div></div>'
    + '<button id="wsxPill"><span class="wsx__pill-text" data-i18n="composer.pill">Ask your workspace…</span></button>'
    + '</div>';
  const streams: Stream[] = [];
  const fetches: { url: string; body: string }[] = [];
  const failNext: { resp: unknown }[] = [];
  const ws = document.getElementById('ws')!;
  const composer = document.getElementById('wsxComposer')!;
  const threadList = document.getElementById('wsxThreadList')!;
  const en = COMPOSER_COPY.en as Record<string, string>;
  const base: Record<string, unknown> = {
    t: (k: string) => en[k] ?? k,
    esc: (s: unknown) => String(s ?? ''),
    ws, composer, threadList,
    pill: document.getElementById('wsxPill'),
    ask: document.getElementById('wsxAsk'),
    LS: { tabs: LS_KEY },
    i18nLoad: () => '',
    fetchMeta: () => {},
    setEditMode: () => {}, publishEdit: () => {}, undoEdit: () => {}, redoEdit: () => {}, discardDraft: () => {},
    // Soft export of the lazy 'data' chunk; the shell's chunk loader keeps it a no-op until the chunk loads.
    dataClear: () => {},
    openComposer: () => composer.setAttribute('data-state', 'sheet'),
    setComposer: (s: string) => composer.setAttribute('data-state', s),
    scrollEnd: () => {},
    removeRow: () => {}, rowOf: () => null,
    addMsg: (_role: string, text: string) => { const b = document.createElement('div'); b.className = 'msg'; b.textContent = text; threadList.appendChild(b); return b; },
    fetch: (url: string, init: { body?: string; signal?: AbortSignal } = {}) => {
      fetches.push({ url, body: String(init.body || '') });
      if (url !== '/v1/create/generate') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      const bad = failNext.shift();
      if (bad) return Promise.resolve(bad.resp);
      return Promise.resolve({ ok: true, body: {}, signal: init.signal });
    },
    // The SSE reader is chat-core's; here each build exposes emit/end to the test.
    readStream: (resp: { signal: AbortSignal }, onEv: (ev: Ev) => void) => new Promise<void>((resolve, reject) => {
      resp.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      streams.push({ emit: onEv, end: resolve, signal: resp.signal });
    }),
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
  const api = new Function('scope', `with (scope) {\n${tabsJs}\n${inspectorJs}\n${createJs}\n; return { tabs: tabs, panes: panes, closeTab, saveTabs, openArtifact, createBuild, activeKey: function () { return activeKey; } }; }`)(scope) as {
    tabs: TabEntry[]; panes: Record<string, { pane: HTMLElement; iframe: HTMLIFrameElement }>;
    closeTab: (k: string) => void; saveTabs: () => void;
    openArtifact: (slug: string, name: string, id: string, type: string) => void;
    createBuild: (prompt: string) => void; activeKey: () => string;
  };
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const liveFrame = () => document.querySelector('.wsx__pane--live iframe') as HTMLIFrameElement | null;
  const pillText = () => document.querySelector('.wsx__pill-text')!.textContent;
  const chat = () => [...threadList.querySelectorAll('.msg')].map(m => m.textContent);
  return { ...api, streams, fetches, failNext, flush, liveFrame, pillText, chat, composer, threadList };
}

const realTabs = (tabs: TabEntry[]) => tabs.filter(x => !x.home);

describe('Studio create: watch it build', () => {
  beforeEach(() => {
    // Stage iframes get a real src; answer it locally instead of hitting the network.
    const hd = (window as unknown as { happyDOM: { settings: { fetch: { interceptor: unknown } } } }).happyDOM;
    hd.settings.fetch.interceptor = { beforeAsyncRequest: () => Promise.resolve(new Response('', { headers: { 'Content-Type': 'text/html' } })) };
    localStorage.clear(); vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('opens an active scripts-only live tab on the first chunk and throttles repaints to 250 ms', async () => {
    const h = load();
    h.createBuild('A weekly sales report');
    await h.flush();
    expect(h.liveFrame()).toBeNull();
    expect(h.tabs.length).toBe(1);

    h.streams[0].emit({ type: 'delta', text: '<h1>Hi' });
    const frame = h.liveFrame()!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toBe('<h1>Hi');
    const live = h.tabs[1];
    expect(live.live).toBe(true);
    expect(live.label).toBe('Building · A weekly sales report');
    expect(h.activeKey()).toBe(live.key);
    expect(frame.closest('.wsx__pane')!.classList.contains('is-active')).toBe(true);
    expect(document.getElementById('wsxHomePane')!.classList.contains('is-active')).toBe(false);
    expect((document.getElementById('wsxTabMode') as HTMLElement).hidden).toBe(true);
    expect(h.composer.getAttribute('data-state')).toBe('resting');
    expect(h.pillText()).toBe('Building your page. Watch it come together.');

    h.streams[0].emit({ type: 'delta', text: ' there' });
    vi.advanceTimersByTime(100);
    h.streams[0].emit({ type: 'delta', text: '</h1>' });
    expect(frame.getAttribute('srcdoc')).toBe('<h1>Hi');
    vi.advanceTimersByTime(150);
    expect(frame.getAttribute('srcdoc')).toBe('<h1>Hi there</h1>');
  });

  it('never shows the markdown fence a streamed page arrives in', async () => {
    const h = load();
    h.createBuild('Fenced page');
    await h.flush();
    h.streams[0].emit({ type: 'delta', text: '```ht' });
    const frame = h.liveFrame()!;
    expect(frame.getAttribute('srcdoc')).toBe('');
    h.streams[0].emit({ type: 'delta', text: 'ml\n<h1>Hi</h1>\n```' });
    vi.advanceTimersByTime(250);
    expect(frame.getAttribute('srcdoc')).toBe('<h1>Hi</h1>');
  });

  it('swaps the published artifact into the same slot: one tab, active, Edit available', async () => {
    const h = load();
    h.openArtifact('older', 'Older', 'art_old', 'html');
    h.createBuild('Pricing calculator');
    await h.flush();
    h.streams[0].emit({ type: 'delta', text: '<p>x</p>' });
    expect(realTabs(h.tabs).map(x => x.key)).toEqual([h.tabs[1].key, 'art_old']);

    h.streams[0].emit({ type: 'done', slug: 'pricing', artifactId: 'art_new', url: 'https://x.test/pricing', html: '<p>x</p>' });
    expect(realTabs(h.tabs).map(x => x.key)).toEqual(['art_new', 'art_old']);
    expect(h.activeKey()).toBe('art_new');
    expect(h.liveFrame()).toBeNull();
    expect(document.querySelectorAll('.wsx__pane--live').length).toBe(0);
    expect((document.getElementById('wsxTabMode') as HTMLElement).hidden).toBe(false);
    const stage = h.panes.art_new.iframe;
    expect(stage.getAttribute('src')).toBe('/a/pricing/?wsx=1');
    expect(h.pillText()).toBe('Ask your workspace…');
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '[]') as { key: string }[];
    expect(saved.map(s => s.key)).toEqual(['art_new', 'art_old']);
  });

  it('never persists the live tab; a reload mid-build restores none', async () => {
    const h = load();
    h.openArtifact('older', 'Older', 'art_old', 'html');
    h.createBuild('Simple CRM');
    await h.flush();
    h.streams[0].emit({ type: 'delta', text: '<p>' });
    h.saveTabs();
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '[]') as { key: string }[];
    expect(saved.map(s => s.key)).toEqual(['art_old']);

    const reloaded = load();
    expect(realTabs(reloaded.tabs).map(x => x.key)).toEqual(['art_old']);
    expect(document.querySelectorAll('.wsx__pane--live').length).toBe(0);
  });

  it('closing the live tab aborts the request', async () => {
    const h = load();
    h.createBuild('RSVP form');
    await h.flush();
    h.streams[0].emit({ type: 'delta', text: '<p>' });
    const key = h.tabs[1].key;
    h.closeTab(key);
    expect(h.streams[0].signal.aborted).toBe(true);
    expect(realTabs(h.tabs)).toEqual([]);
    expect(h.activeKey()).toBe('home');
    await h.flush();
    expect(h.chat().pop()).toBe('Build stopped.');
    expect(h.pillText()).toBe('Ask your workspace…');
  });

  it('shows the error and Try again in the live tab; retry reuses it', async () => {
    const h = load();
    h.createBuild('Status tracker');
    await h.flush();
    h.streams[0].emit({ type: 'delta', text: '<p>' });
    h.streams[0].emit({ type: 'error', error: 'The builder hit a snag — try again.' });
    const err = document.querySelector('.wsx-live__err') as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.querySelector('.wsx-live__msg')!.textContent).toBe('Build failed: The builder hit a snag — try again.');
    const retry = err.querySelector('.wsx-live__retry') as HTMLButtonElement;
    expect(retry.textContent).toBe('Try again');
    expect(realTabs(h.tabs).length).toBe(1);

    retry.click();
    await h.flush();
    expect(h.streams.length).toBe(2);
    expect(err.hidden).toBe(true);
    expect(realTabs(h.tabs).length).toBe(1);
    h.streams[1].emit({ type: 'delta', text: '<p>again' });
    expect(h.liveFrame()!.getAttribute('srcdoc')).toBe('<p>again');
    h.streams[1].emit({ type: 'done', slug: 'status', artifactId: 'art_s' });
    expect(realTabs(h.tabs).map(x => x.key)).toEqual(['art_s']);
    expect(h.streams[0].signal.aborted).toBe(false);
  });

  it('closing the retried tab aborts the new request, not the failed one', async () => {
    const h = load();
    h.createBuild('Dashboard');
    await h.flush();
    h.streams[0].emit({ type: 'delta', text: '<p>' });
    h.streams[0].emit({ type: 'error', error: 'snag' });
    (document.querySelector('.wsx-live__retry') as HTMLButtonElement).click();
    await h.flush();
    h.closeTab(h.tabs[1].key);
    expect(h.streams[1].signal.aborted).toBe(true);
  });

  it('a failure before any chunk stays in the chat with Try again, no tab', async () => {
    const h = load();
    h.failNext.push({ resp: { ok: false, body: null, json: () => Promise.resolve({ error: 'Daily limit reached.' }) } });
    h.createBuild('Calculator');
    await h.flush();
    expect(realTabs(h.tabs)).toEqual([]);
    expect(h.chat().pop()).toBe('Build failed: Daily limit reached.');
    const retry = h.threadList.querySelector('.wsx-confirm__ok') as HTMLButtonElement;
    expect(retry.textContent).toBe('Try again');
    retry.click();
    await h.flush();
    expect(h.fetches.filter(f => f.url === '/v1/create/generate').length).toBe(2);
  });

  it('a stream that ends without a result reports the dropped connection in the tab', async () => {
    const h = load();
    h.createBuild('Report');
    await h.flush();
    h.streams[0].emit({ type: 'delta', text: '<p>' });
    h.streams[0].end();
    await h.flush();
    expect((document.querySelector('.wsx-live__err') as HTMLElement).hidden).toBe(false);
    expect(document.querySelector('.wsx-live__msg')!.textContent).toBe('Connection dropped during build.');
  });
});

describe('create copy', () => {
  it('ships the live-build strings in English and Spanish', () => {
    const en = COMPOSER_COPY.en as Record<string, string>;
    const es = COMPOSER_COPY.es as Record<string, string>;
    expect(en['create.buildingTab']).toBe('Building · {name}');
    expect(es['create.buildingTab']).toBe('Creando · {name}');
    expect(es['create.buildingLive']).toBe('Creando tu artefacto. Miralo armarse.');
    expect(es['create.retry']).toBe('Probá de nuevo');
    expect(es['create.buildStopped']).toBe('Se frenó la creación.');
  });
});
