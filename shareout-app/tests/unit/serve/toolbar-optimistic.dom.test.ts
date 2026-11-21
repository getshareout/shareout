// @vitest-environment happy-dom
//
// Viewer toolbar actions are optimistic: the UI changes on click, the
// request runs behind, and a failure restores the previous state with a clear message.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { componentScripts } from '../../../src/design-system/components/index';
import { renderToolbarScriptCore } from '../../../src/serve/sandbox-viewer/toolbar/script-core';
import { renderToolbarScriptAuth } from '../../../src/serve/sandbox-viewer/toolbar/script-auth';
import { TOOLBAR_COPY } from '../../../src/serve/sandbox-viewer/toolbar/copy';

const es = TOOLBAR_COPY.es;
let fetchMock: ReturnType<typeof vi.fn>;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const toastText = () => [...document.querySelectorAll('.so-c-toast')].map((t) => t.textContent).join(' | ');
type W = Record<string, (...a: unknown[]) => unknown>;
const w = () => window as unknown as W;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{}'));
  (globalThis as unknown as { fetch: unknown }).fetch = (...a: unknown[]) => fetchMock(...a);
  document.body.innerHTML = '';
  eval(componentScripts);
});
afterEach(() => vi.useRealTimers());

function loadToolbar(): void {
  const js = renderToolbarScriptCore(es, 'es') + renderToolbarScriptAuth('', 'a1', 'me@x.test', es);
  new Function(`(function(){${js}})();`)();
}

describe('toolbar favorite', () => {
  it('flips at once, uses the viewer locale for Retry, and flips back when the request fails', async () => {
    document.body.innerHTML = '<button id="so-fav-btn"><svg></svg></button><span id="so-fav-label"></span>';
    let resolve!: (r: Response) => void;
    fetchMock = vi.fn(() => new Promise<Response>((r) => { resolve = r; }));
    loadToolbar();
    const btn = document.getElementById('so-fav-btn')!;
    w().toggleFav();
    expect(btn.classList.contains('active')).toBe(true);
    expect(document.getElementById('so-fav-label')!.textContent).toBe(es.favorited);
    w().toggleFav(); // double click while in flight is ignored
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(new Response('{}', { status: 500 }));
    await flush();
    expect(btn.classList.contains('active')).toBe(false);
    expect(toastText()).toContain(es.favFailed);
    expect(toastText()).toContain(es.retry);
  });
});

describe('toolbar follow alerts', () => {
  it('cancelling an alert removes the row at once and holds the DELETE behind Undo', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="so-follow-mine"><div id="row"><span>Rev</span><button onclick="soFollowCancel(\'al_1\')">x</button></div></div>';
    loadToolbar();
    w().soFollowCancel('al_1');
    expect(document.getElementById('row')!.classList.contains('so-c-leaving')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastText()).toContain(es.alertCancelled);
    document.querySelector<HTMLButtonElement>('.so-c-toast__act')!.click();
    expect(document.getElementById('row')!.classList.contains('so-c-leaving')).toBe(false);
    vi.advanceTimersByTime(10000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('header title menu and comments button', () => {
  function loadHeader(): void {
    document.body.innerHTML = '<header><div id="wrap"><button id="so-hd-menu-btn" aria-expanded="false">T</button>'
      + '<div id="so-hd-menu" hidden><button role="menuitem" id="item">Follow</button></div></div>'
      + '<button id="so-cmt-btn">C</button><p id="outside">x</p></header><div id="so-comments-overlay"></div>';
    new Function(`(function(){${renderToolbarScriptCore(es, 'es')}})();`)();
    w().openComments = () => document.getElementById('so-comments-overlay')!.classList.add('open');
    w().closeComments = () => document.getElementById('so-comments-overlay')!.classList.remove('open');
  }

  it('opens and closes the menu, and a click outside closes it', () => {
    loadHeader();
    const menu = document.getElementById('so-hd-menu')!;
    const btn = document.getElementById('so-hd-menu-btn')!;
    w().soHdMenu();
    expect(menu.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    document.getElementById('item')!.click();
    expect(menu.hidden).toBe(false);
    document.getElementById('outside')!.click();
    expect(menu.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('a click inside the artifact frame (the window loses focus) closes the menu', () => {
    loadHeader();
    w().soHdMenu();
    expect(document.getElementById('so-hd-menu')!.hidden).toBe(false);
    window.dispatchEvent(new Event('blur'));
    expect(document.getElementById('so-hd-menu')!.hidden).toBe(true);
    expect(document.getElementById('so-hd-menu-btn')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves focus into the menu only when opened from the keyboard, and Esc closes it', () => {
    loadHeader();
    w().soHdMenu(undefined, { detail: 1 });
    expect(document.activeElement?.id).not.toBe('item');
    w().soHdMenu(false);
    w().soHdMenu(undefined, { detail: 0 });
    expect(document.activeElement?.id).toBe('item');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('so-hd-menu')!.hidden).toBe(true);
    expect(document.activeElement?.id).toBe('so-hd-menu-btn');
  });

  it('the Comments button opens the side panel and closes it when it is open', () => {
    loadHeader();
    const ov = document.getElementById('so-comments-overlay')!;
    w().soHdComments();
    expect(ov.classList.contains('open')).toBe(true);
    expect(document.getElementById('so-cmt-btn')!.getAttribute('aria-expanded')).toBe('true');
    w().soHdComments();
    expect(ov.classList.contains('open')).toBe(false);
    expect(document.getElementById('so-cmt-btn')!.getAttribute('aria-expanded')).toBe('false');
  });
});
