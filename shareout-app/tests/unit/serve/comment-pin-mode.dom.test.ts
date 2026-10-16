// @vitest-environment happy-dom
//
// Placing a pinned comment never dims or blurs the page: arming closes the panel,
// a click on the artifact opens an inline composer at that spot, and placement is
// torn down on submit, Esc, an in-frame navigation or leaving the tab, so no
// overlay or pin mode can outlive the page it started on.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildToolbarContext } from '../../../src/serve/sandbox-viewer/toolbar/context';
import { renderToolbarMarkup } from '../../../src/serve/sandbox-viewer/toolbar/markup';
import { renderToolbarScriptCore } from '../../../src/serve/sandbox-viewer/toolbar/script-core';
import { renderToolbarScriptComments } from '../../../src/serve/sandbox-viewer/toolbar/script-comments';
import { TOOLBAR_COPY } from '../../../src/serve/sandbox-viewer/toolbar/copy';

const es = TOOLBAR_COPY.es;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
type W = Record<string, (...a: unknown[]) => unknown>;
const w = () => window as unknown as W;

describe('viewer: pinned comment placement', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let iframe: HTMLIFrameElement;
  let toFrame: Array<{ type: string }>;

  const overlayOpen = () => document.getElementById('so-comments-overlay')!.classList.contains('open');
  const fromFrame = (data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { data, source: iframe.contentWindow as Window }));
  const sent = (type: string) => toFrame.filter((m) => m.type === type).length;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
    (globalThis as unknown as { fetch: unknown }).fetch = (...a: unknown[]) => fetchMock(...a);
    const ctx = buildToolbarContext({
      loggedIn: true, isFav: false, commentsEnabled: true, commentCount: 0, hasMetrics: false,
      adminInfo: null, currentUser: { id: 'u1', email: 'viewer@example.com', name: 'Viewer', picture: null },
      hideToolbar: false, baseUrl: '', slug: 'demo', artifactId: 'art_1', visualEditorEnabled: false,
      attachedSkills: [], locale: 'es',
    })!;
    document.body.innerHTML = '<iframe></iframe>' + renderToolbarMarkup(ctx);
    iframe = document.querySelector('iframe')!;
    toFrame = [];
    vi.spyOn(iframe.contentWindow as Window, 'postMessage').mockImplementation(((m: { type: string }) => { toFrame.push(m); }) as never);
    const js = renderToolbarScriptCore(es, 'es') + renderToolbarScriptComments('', 'art_1', es, 'es');
    new Function(`(function(){${js}})();`)();
  });

  it('arming closes the panel (no backdrop) and shows a hint instead', () => {
    document.getElementById('so-comments-overlay')!.classList.add('open');
    w().togglePinMode();
    expect(overlayOpen()).toBe(false);
    expect(document.getElementById('so-pin-hint')!.textContent).toBe(es.pinHint);
    expect(sent('shareout:comments:enterPinMode')).toBe(1);
    w().togglePinMode();
    expect(document.getElementById('so-pin-hint')).toBeNull();
  });

  it('a click on the page opens an inline composer at that spot and posts the pinned comment', async () => {
    w().togglePinMode();
    const position = { selector: 'body', relX: 0.5, relY: 0.5, pctX: 0.5, pctY: 0.2, scrollY: 0 };
    fromFrame({ type: 'shareout:comments:pinPlaced', position, x: 120, y: 80 });
    const draft = document.getElementById('so-pin-draft')!;
    expect(draft.style.left).toBe('120px');
    expect(draft.style.top).toBe('80px');
    expect(document.getElementById('so-pin-hint')).toBeNull();
    expect(overlayOpen()).toBe(false);

    (document.getElementById('so-pin-input') as HTMLTextAreaElement).value = 'Revisar este dato';
    (document.getElementById('so-pin-submit') as HTMLButtonElement).click();
    await flush();
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    const body = JSON.parse(String((post![1] as RequestInit).body));
    expect(body.content).toBe('Revisar este dato');
    expect(body.position).toEqual(position);
    expect(document.getElementById('so-pin-draft')).toBeNull();
    expect(sent('shareout:comments:exitPinMode')).toBe(1);
  });

  it('a navigation inside the artifact frame ends placement', () => {
    w().togglePinMode();
    fromFrame({ type: 'shareout:comments:pinPlaced', position: { selector: 'body' }, x: 10, y: 10 });
    iframe.dispatchEvent(new Event('load'));
    expect(document.getElementById('so-pin-draft')).toBeNull();
    expect(document.getElementById('so-pin-hint')).toBeNull();
    expect(sent('shareout:comments:exitPinMode')).toBe(1);
    // A late pinPlaced from the old page is ignored once placement ended.
    fromFrame({ type: 'shareout:comments:pinPlaced', position: { selector: 'body' }, x: 10, y: 10 });
    expect(document.getElementById('so-pin-draft')).toBeNull();
  });

  it('Esc (in the page or in the frame), Cancel, and leaving the tab all cancel', () => {
    w().togglePinMode();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('so-pin-hint')).toBeNull();

    w().togglePinMode();
    fromFrame({ type: 'shareout:comments:pinCancel' });
    expect(document.getElementById('so-pin-hint')).toBeNull();

    w().togglePinMode();
    fromFrame({ type: 'shareout:comments:pinPlaced', position: { selector: 'body' }, x: 10, y: 10 });
    (document.getElementById('so-pin-cancel') as HTMLButtonElement).click();
    expect(document.getElementById('so-pin-draft')).toBeNull();

    w().togglePinMode();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.getElementById('so-pin-hint')).toBeNull();
    delete (document as unknown as { hidden?: boolean }).hidden;
    expect(sent('shareout:comments:exitPinMode')).toBe(4);
  });
});

describe('comments agent (in the artifact frame)', () => {
  const agent = readFileSync(join(__dirname, '../../../sdk/src/comments-agent/agent.js'), 'utf8');
  const toParent = (type: string) => (data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { data: { type, ...(data as object) }, source: window }));

  it('stays armed with a pin cursor until told to exit; clicks place the pin instead of following links', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<a id="lnk" href="page-a.html">Next</a>';
    delete (window as unknown as { __shareoutCommentsAgent?: boolean }).__shareoutCommentsAgent;
    const posted: Array<{ type: string }> = [];
    vi.spyOn(window, 'postMessage').mockImplementation(((m: { type: string }) => { posted.push(m); }) as never);
    new Function(agent)();

    toParent('shareout:comments:enterPinMode')({});
    expect(document.head.querySelector('style')!.textContent).toContain('cursor');
    const click = () => {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 });
      document.getElementById('lnk')!.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(click()).toBe(true);
    expect(click()).toBe(true);
    const placed = posted.filter((m) => m.type === 'shareout:comments:pinPlaced');
    expect(placed).toHaveLength(2);
    expect(placed[0]).toMatchObject({ x: 5, y: 6 });

    toParent('shareout:comments:exitPinMode')({});
    expect(document.head.querySelector('style')).toBeNull();
    expect(click()).toBe(false);
  });
});
