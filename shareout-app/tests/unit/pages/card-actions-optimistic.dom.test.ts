// @vitest-environment happy-dom
//
// Artifact card actions are optimistic: the card leaves (or the star flips) on click,
// the request runs behind, and a failure puts everything back with an error toast.
// Delete holds the DELETE behind a "Deleted · Undo" toast.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { componentScripts } from '../../../src/design-system/components/index';
import { workspace_client_home_views_cardActions_JS as cardJs } from '../../../src/pages/home/render-workspace/client-script/home-views/card-actions';
import { workspace_client_home_views_modalsForms_JS as modalsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/modals-forms';

let fetchMock: ReturnType<typeof vi.fn>;
type Api = { hidePendingArts: (root?: Element) => void; setFolder: (f: string) => void };

function load(): Api {
  const win = globalThis.window as unknown as Record<string, unknown>;
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string | symbol, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'window') return win;
      if (prop === 't') return (k: string) => k;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s));
      if (prop === 'optimistic') return (o: unknown) => (win.soOptimistic as (o: unknown) => Promise<boolean>)(o);
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop === 'showToast') return win.showToast;
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  const body = `with (scope) {\nvar curFolder = '';\nvar artCache = {};\n${modalsJs}\n${cardJs}\n; return { hidePendingArts: hidePendingArts, setFolder: function (f) { curFolder = f; } }; }`;
  return new Function('scope', body)(scope);
}

const card = (id: string) => `<div class="artifact-card" data-id="${id}" data-favorite="0" data-folder=""><span class="card-title">Plan ${id}</span><button class="fav-toggle"><svg></svg></button></div>`;
const visible = (id: string) => {
  const el = document.querySelector<HTMLElement>(`.artifact-card[data-id="${id}"]`);
  return !!el && el.style.display !== 'none' && !el.classList.contains('so-c-leaving');
};
const toastText = () => [...document.querySelectorAll('.so-c-toast')].map((t) => t.textContent).join(' | ');
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

beforeEach(() => {
  document.body.innerHTML = `<div id="grid">${card('a1')}${card('a2')}</div>`;
  eval(componentScripts);
  fetchMock = vi.fn(async () => new Response('{}'));
});
afterEach(() => vi.useRealTimers());

describe('artifact delete', () => {
  it('confirm closes at once, the card leaves, and the DELETE waits for the undo window', async () => {
    vi.useFakeTimers();
    load();
    (window as unknown as { confirmDelete(id: string): void }).confirmDelete('a1');
    document.getElementById('fld_go')!.click();
    expect(document.querySelector('.wsx-modal')).toBeNull();
    expect(visible('a1')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastText()).toContain('cards.deletedOne');
    vi.advanceTimersByTime(5000);
    expect(fetchMock).toHaveBeenCalledWith('/v1/artifacts/a1', expect.objectContaining({ method: 'DELETE', keepalive: true }));
    await vi.runAllTimersAsync();
    expect(document.querySelector('.artifact-card[data-id="a1"]')).toBeNull();
  });

  it('Undo brings the card back in place and never sends the DELETE', async () => {
    vi.useFakeTimers();
    load();
    (window as unknown as { confirmDelete(id: string): void }).confirmDelete('a1');
    document.getElementById('fld_go')!.click();
    document.querySelector<HTMLButtonElement>('.so-c-toast__act')!.click();
    expect(visible('a1')).toBe(true);
    expect(document.getElementById('grid')!.firstElementChild!.getAttribute('data-id')).toBe('a1');
    vi.advanceTimersByTime(10000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed DELETE restores the card and shows an error with Retry', async () => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
    load();
    (window as unknown as { confirmDelete(id: string): void }).confirmDelete('a1');
    document.getElementById('fld_go')!.click();
    vi.advanceTimersByTime(5000);
    await vi.advanceTimersByTimeAsync(10);
    expect(visible('a1')).toBe(true);
    const err = document.querySelector('.so-c-toast--error')!;
    expect(err.textContent).toContain('cards.deleteFailed');
    expect(err.querySelector('.so-c-toast__act')).not.toBeNull();
  });

  it('a list reload during the undo window keeps the deleted card hidden', () => {
    vi.useFakeTimers();
    const api = load();
    (window as unknown as { confirmDelete(id: string): void }).confirmDelete('a1');
    document.getElementById('fld_go')!.click();
    document.getElementById('grid')!.innerHTML = card('a1') + card('a2');
    api.hidePendingArts(document.getElementById('grid')!);
    expect(visible('a1')).toBe(false);
    expect(visible('a2')).toBe(true);
  });
});

describe('favorite', () => {
  it('flips at once, ignores a double click, and flips back when the request fails', async () => {
    let resolve!: (r: Response) => void;
    fetchMock = vi.fn(() => new Promise<Response>((r) => { resolve = r; }));
    load();
    const fav = window as unknown as { toggleFavorite(id: string): void };
    fav.toggleFavorite('a1');
    const el = document.querySelector<HTMLElement>('.artifact-card[data-id="a1"]')!;
    expect(el.dataset.favorite).toBe('1');
    fav.toggleFavorite('a1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el.dataset.favorite).toBe('1');
    resolve(new Response('{}', { status: 500 }));
    await flush();
    expect(el.dataset.favorite).toBe('0');
    expect(toastText()).toContain('cards.favFailed');
  });
});

describe('move to folder', () => {
  it('the picker closes and the card leaves the open folder at once; a failed move brings it back', async () => {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ folders: [{ id: 'fld_2', name: 'Q3' }] })));
    const api = load();
    api.setFolder('fld_1');
    (window as unknown as { openFolderPicker(ids: string[]): void }).openFolderPicker(['a1']);
    await flush();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fetchMock.mockImplementationOnce(async () => { await gate; return new Response('{}', { status: 500 }); });
    document.querySelector<HTMLElement>('.folder-picker-item[data-folder="fld_2"]')!.click();
    expect(document.querySelector('.wsx-modal')).toBeNull();
    expect(visible('a1')).toBe(false);
    expect(document.querySelector<HTMLElement>('.artifact-card[data-id="a1"]')!.dataset.folder).toBe('fld_2');
    release();
    await flush();
    expect(visible('a1')).toBe(true);
    expect(document.querySelector<HTMLElement>('.artifact-card[data-id="a1"]')!.dataset.folder).toBe('');
    expect(toastText()).toContain('cards.moveFailed');
  });
});
