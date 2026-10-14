// @vitest-environment happy-dom
//
// Viewer toolbar + share dialog actions are optimistic: the UI changes on click, the
// request runs behind, and a failure restores the previous state with a clear message.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { componentScripts } from '../../../src/design-system/components/index';
import { renderToolbarScriptCore } from '../../../src/serve/sandbox-viewer/toolbar/script-core';
import { renderToolbarScriptAuth } from '../../../src/serve/sandbox-viewer/toolbar/script-auth';
import { renderToolbarScriptAdmin } from '../../../src/serve/sandbox-viewer/toolbar/script-admin';
import { TOOLBAR_COPY } from '../../../src/serve/sandbox-viewer/toolbar/copy';
import { shareModalMarkup, shareModalScript } from '../../../src/components/share-modal';

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

describe('admin comments toggle', () => {
  it('flips the label at once and flips it back if saving fails', async () => {
    document.body.innerHTML = '<button id="so-cmt-toggle">On</button>';
    fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
    const js = renderToolbarScriptCore(es, 'es') + 'var cmtOverlayOn = true;' + renderToolbarScriptAdmin('', 's', 'a1', es);
    new Function(`(function(){${js}})();`)();
    w().toggleCommentsOverlay();
    expect(document.getElementById('so-cmt-toggle')!.textContent).toBe('Off');
    await flush();
    expect(document.getElementById('so-cmt-toggle')!.textContent).toBe('On');
    expect(toastText()).toContain(es.settingFail);
  });
});

describe('share dialog', () => {
  function openWith(emails: string): void {
    document.body.innerHTML = shareModalMarkup('en');
    new Function(shareModalScript({ baseUrl: '', locale: 'en' }))();
    w().openShare('a1', 'slug', 'Plan', true, null);
    (document.getElementById('soShareEmails') as HTMLInputElement).value = emails;
  }
  const overlayOpen = () => (document.getElementById('soShareOverlay') as HTMLElement).style.display === 'flex';

  it('closes at once with "invites sent"', async () => {
    openWith('ana@x.test, bo@x.test');
    w().submitShare();
    expect(overlayOpen()).toBe(false);
    await flush();
    expect(toastText()).toContain('2');
  });

  it('a refusal reopens the dialog as filled in, with the server reason', async () => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Not allowed to share' }), { status: 403 }));
    openWith('ana@x.test');
    w().submitShare();
    expect(overlayOpen()).toBe(false);
    await flush();
    expect(overlayOpen()).toBe(true);
    expect((document.getElementById('soShareEmails') as HTMLInputElement).value).toBe('ana@x.test');
    expect(document.getElementById('soShareStatus')!.textContent).toBe('Not allowed to share');
  });
});
