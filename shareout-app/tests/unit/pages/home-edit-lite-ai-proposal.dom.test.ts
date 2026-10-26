// @vitest-environment happy-dom
//
// Quick edit AI: ask about an element (or the page), see the result in place as a
// proposal, keep or discard it. Keep is one undo step; Discard leaves the source
// byte-identical; a change whose target can't be found touches nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_edit_lite_JS as editJs } from '../../../src/pages/home/render-workspace/client-script/edit-lite';
import { workspace_client_edit_lite_ai_JS as aiJs } from '../../../src/pages/home/render-workspace/client-script/edit-lite-ai';
import { workspace_client_tabs_JS as tabsJs } from '../../../src/pages/home/render-workspace/client-script/tabs';

type Rec = Record<string, any>;
type Api = Record<string, (...a: any[]) => any>;
type Call = { url: string; method: string; body: any };

// The undo/redo history lives in the tabs shell; take just that part.
const historyJs = tabsJs.slice(tabsJs.indexOf('  // Undo/redo snapshots'));

const PAGE = '<!DOCTYPE html><html><head><style>h2{color:red}</style></head><body><section><h2>Title</h2><p>Hello <b>world</b></p><img src="cat.png" alt=""></section><footer><p>Bye</p></footer></body></html>';

let api: Api, rec: Rec, rbody: HTMLElement, calls: Call[], chat: unknown[][];

function sse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const done = (response: unknown) => [{ type: 'content', content: '{' }, { type: 'done', changeId: 'chg_1', response }];
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

// The edit frame: srcdoc is "loaded" by parsing it and firing onload, like the browser.
function load() {
  rec.editframe.contentDocument = new DOMParser().parseFromString(rec.editframe.srcdoc, 'text/html');
  const f = rec.editframe.onload; if (f) f();
}
const live = (id: string) => rec.editframe.contentDocument.querySelector(`[data-wsx-id="${id}"]`);
const btn = (sel: string) => rbody.querySelector(sel) as HTMLButtonElement;
const ask = (text: string) => {
  (rbody.querySelector('#wsxAiPrompt') as HTMLInputElement).value = text;
  btn('#wsxAiGo').click();
};

beforeEach(() => {
  document.body.innerHTML = '<div id="rbody"></div>';
  rbody = document.getElementById('rbody')!;
  calls = []; chat = [];
  const mk = () => document.createElement('button');
  rec = {
    mode: 'edit', md: null, sel: null, pendingSel: null, history: [], histIdx: -1, dirty: false,
    art: { id: 'art_1', slug: 'demo', name: 'Demo' }, editframe: { srcdoc: '', onload: null, contentDocument: null },
    pane: document.createElement('div'), savestat: document.createElement('span'),
    publishBtn: mk(), undoBtn: mk(), redoBtn: mk(), discardBtn: mk(), iframe: document.createElement('iframe'),
  };
  const target: Record<string, unknown> = {
    rbodyEl: rbody, panes: { a: rec }, activeKey: 'a', metaCache: {},
    t: (k: string) => k, tOr: (_k: string, f: string) => f, esc: (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    setSaveStatus: vi.fn(), renderTabs: vi.fn(),
    mdRoot: (d: Document) => d.querySelector('[data-md-root]') || d.body,
    readStream: (resp: Response, onEv: (e: unknown) => void) => {
      const reader = resp.body!.getReader(); const dec = new TextDecoder(); let buf = '';
      const pump = (): Promise<void> => reader.read().then((r) => {
        if (r.done) return;
        buf += dec.decode(r.value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop()!;
        parts.forEach((p) => { const line = p.replace(/^data: /, '').trim(); if (line) onEv(JSON.parse(line)); });
        return pump();
      });
      return pump();
    },
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method: init?.method || 'GET', body });
      if (url.endsWith('/editor/chat/normal')) return sse((chat.shift() as unknown[]) || done({ type: 'explanation', message: 'Nothing to do.' }));
      return new Response(JSON.stringify({ success: true, draftUpdatedAt: 'D2' }), { headers: { 'Content-Type': 'application/json' } });
    }),
  };
  const scope = new Proxy(target, {
    has: () => true,
    get: (tg, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in tg) return tg[prop];
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
    set: (tg, prop, value) => { tg[prop as string] = value; return true; },
  });
  const names = ['setSel', 'renderLive', 'serializeClean', 'stampTree', 'editKeydown', 'publishEdit', 'undoEdit', 'pushHistory'];
  api = new Function('scope', `with (scope) {\n${editJs}\n${aiJs}\n${historyJs}\n; return { ${names.map((n) => `${n}: ${n}`).join(', ')} }; }`)(scope) as Api;

  rec.srcDoc = new DOMParser().parseFromString(PAGE, 'text/html');
  rec.idCounter = api.stampTree(rec.srcDoc, 0);
  api.renderLive(rec); load();
});

const ORIGINAL = () => api.serializeClean(rec);
const selectText = (id: string) => api.setSel(rec, { type: 'text', el: live(id) });
const replaceTitle = () => done({ type: 'html_patch', message: 'Made the title punchier.', patches: [{ selector: '[data-editor-id="w1"]', action: 'replace', content: '<h2 data-wsx-id="1" data-editor-id="w1">A better title</h2>' }] });

describe('asking AI about an element', () => {
  it('sends the page with data-editor-id beside data-wsx-id and targets the selection', async () => {
    selectText('1');
    chat.push(replaceTitle());
    ask('Make it punchier');
    await flush();
    const req = calls.find((c) => c.url.endsWith('/editor/chat/normal'))!;
    expect(req.body.prompt).toBe('Only modify the selected element. Make it punchier');
    expect(req.body.context.htmlMode).toBe('full');
    expect(req.body.context.selection.selector).toBe('[data-editor-id="w1"]');
    expect(req.body.context.documentHtml).toContain('data-wsx-id="1" data-editor-id="w1"');
  });

  it('shows the result in place as an outlined proposal, without touching the source', async () => {
    const before = ORIGINAL();
    selectText('1');
    chat.push(replaceTitle());
    ask('Make it punchier');
    await flush();
    expect(rec.proposal).toBeTruthy();
    expect(ORIGINAL()).toBe(before);
    expect(rec.editframe.srcdoc).toContain('A better title');
    expect(rec.editframe.srcdoc).toMatch(/\[data-wsx-id="1"\]\{outline:2px solid/);
    expect(rbody.querySelector('.wsx-prop__reply')!.textContent).toBe('Made the title punchier.');
    expect([...rbody.querySelectorAll('[data-pact]')].map((b) => b.textContent)).toEqual(['edit.aiKeep', 'edit.aiTryAgain', 'edit.aiDiscard']);
    expect(rec.undoBtn.disabled && rec.publishBtn.disabled && rec.discardBtn.disabled).toBe(true);
  });

  it('Keep commits, saves, reports apply, and Undo goes back exactly one step', async () => {
    const before = ORIGINAL();
    selectText('1');
    chat.push(replaceTitle());
    ask('Make it punchier');
    await flush();
    const steps = rec.history.length;
    btn('[data-pact="keep"]').click();
    await flush();
    expect(rec.proposal).toBeNull();
    expect(rec.history.length).toBe(steps + 1);
    const kept = ORIGINAL();
    expect(kept).toContain('<h2>A better title</h2>');
    expect(kept).not.toContain('data-editor-id');
    expect(rec.srcDoc.querySelector('h2')!.getAttribute('data-wsx-id')).toBe('1');
    expect(calls.some((c) => c.url.endsWith('/editor/draft') && c.body.html === kept)).toBe(true);
    expect(calls.find((c) => c.url.endsWith('/editor/chat/apply'))!.body).toEqual({ changeId: 'chg_1' });
    load();
    expect(rec.sel.el).toBe(live('1'));
    api.undoEdit(rec);
    expect(ORIGINAL()).toBe(before);
  });

  it('Discard leaves the source byte-identical and reports reject; Esc discards too', async () => {
    const before = ORIGINAL();
    selectText('1');
    chat.push(replaceTitle());
    ask('Make it punchier');
    await flush();
    btn('[data-pact="discard"]').click();
    expect(rec.proposal).toBeNull();
    expect(ORIGINAL()).toBe(before);
    expect(calls.find((c) => c.url.endsWith('/editor/chat/reject'))!.body).toEqual({ changeId: 'chg_1' });
    load();
    expect(rec.sel.el).toBe(live('1'));

    chat.push(replaceTitle());
    ask('Again');
    await flush();
    rbody.querySelector('[data-prop]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(rec.proposal).toBeNull();
    expect(ORIGINAL()).toBe(before);
  });

  it('Before/After never loses the proposal', async () => {
    selectText('1');
    chat.push(replaceTitle());
    ask('Make it punchier');
    await flush();
    btn('[data-pview="before"]').click();
    expect(rec.editframe.srcdoc).toContain('<h2 data-wsx-id="1">Title</h2>');
    expect(rec.editframe.srcdoc).not.toMatch(/\[data-wsx-id="1"\]\{outline/);
    expect(btn('[data-pview="before"]').getAttribute('aria-pressed')).toBe('true');
    btn('[data-pview="after"]').click();
    btn('[data-pview="before"]').click();
    expect(rec.proposal.view).toBe('before');
    btn('[data-pact="keep"]').click();
    expect(ORIGINAL()).toContain('A better title');
  });

  it('locks other editing while a proposal is open', async () => {
    selectText('1');
    chat.push(replaceTitle());
    ask('Make it punchier');
    await flush();
    const n = calls.length, steps = rec.histIdx;
    const z = { key: 'z', metaKey: true, preventDefault: vi.fn() };
    api.editKeydown(rec, z);
    expect(z.preventDefault).toHaveBeenCalled();
    expect(rec.histIdx).toBe(steps);
    api.publishEdit(rec);
    expect(calls.length).toBe(n);
  });

  it('Try again discards and asks the same thing again', async () => {
    selectText('1');
    chat.push(replaceTitle());
    ask('Make it punchier');
    await flush();
    chat.push(replaceTitle());
    btn('[data-pact="retry"]').click();
    await flush();
    const asks = calls.filter((c) => c.url.endsWith('/editor/chat/normal'));
    expect(asks).toHaveLength(2);
    expect(asks[1].body.prompt).toBe(asks[0].body.prompt);
    expect(rec.proposal).toBeTruthy();
  });
});

describe('honest states', () => {
  it('a change whose target is missing touches nothing, never the selected element', async () => {
    const before = ORIGINAL();
    selectText('1');
    chat.push(done({ type: 'html_patch', message: 'Done.', patches: [{ selector: '[data-editor-id="w99"]', action: 'setStyle', attribute: 'color', value: 'blue' }] }));
    ask('Make it blue');
    await flush();
    expect(rec.proposal).toBeFalsy();
    expect(ORIGINAL()).toBe(before);
    expect(rbody.querySelector('.wsx-edit__aiwarn')!.textContent).toBe('edit.aiMissed');
    expect(calls.some((c) => c.url.endsWith('/editor/chat/reject'))).toBe(true);
  });

  it('applies what it can find and says a part could not be placed', async () => {
    selectText('2');
    chat.push(done({ type: 'html_patch', message: 'Done.', patches: [
      { selector: '[data-editor-id="w99"]', action: 'delete' },
      { selector: '[data-editor-id="w2"]', action: 'setStyle', attribute: 'color', value: 'blue' },
    ] }));
    ask('Blue');
    await flush();
    expect(rec.proposal.missed).toBe(1);
    expect(rec.proposal.changed).toEqual(['2']);
    expect(rbody.querySelector('.wsx-edit__aiwarn')!.textContent).toBe('edit.aiMissed');
    btn('[data-pact="keep"]').click();
    expect(rec.srcDoc.querySelector('[data-wsx-id="2"]')!.getAttribute('style')).toBe('color: blue;');
    expect(ORIGINAL()).toContain('<h2>Title</h2>');
  });

  it('a reply with no changes stays visible and the box stays usable', async () => {
    selectText('1');
    chat.push(done({ type: 'explanation', message: 'It is an h2 heading.' }));
    ask('What is this?');
    await flush();
    expect(rec.proposal).toBeFalsy();
    expect(rbody.querySelector('.wsx-edit__aireply')!.textContent).toContain('It is an h2 heading.');
    expect(btn('#wsxAiGo').disabled).toBe(false);
    btn('[data-ai-dismiss]').click();
    expect(rbody.querySelector('.wsx-edit__aireply')).toBeNull();
  });

  it('an error shows inline with Try again, and the buttons work again', async () => {
    selectText('1');
    chat.push([{ type: 'error', error: 'AI not configured' }]);
    ask('Shorter');
    await flush();
    expect(rbody.querySelector('#wsxAiStat .is-err')!.textContent).toBe('AI not configured');
    expect(btn('#wsxAiGo').disabled).toBe(false);
    expect(btn('[data-ai="rewrite"]').disabled).toBe(false);
    chat.push(replaceTitle());
    btn('[data-ai-retry]').click();
    await flush();
    expect(rec.proposal).toBeTruthy();
  });

  it('turns the buttons off while working', async () => {
    selectText('1');
    ask('Shorter');
    expect(btn('#wsxAiGo').disabled).toBe(true);
    expect(rbody.querySelector('#wsxAiStat')!.textContent).toBe('edit.aiWorking');
    await flush();
  });
});

describe('where you can ask', () => {
  it('the idle panel asks about the whole page', async () => {
    api.setSel(rec, null);
    chat.push(done({ type: 'html_patch', message: 'Added a footer note.', patches: [{ selector: '[data-editor-id="w5"]', action: 'insert', content: '<small>Thanks</small>' }] }));
    ask('Add a thank-you note to the footer');
    await flush();
    const req = calls.find((c) => c.url.endsWith('/editor/chat/normal'))!;
    expect(req.body.prompt).toBe('Add a thank-you note to the footer');
    expect(req.body.context.selection).toBeUndefined();
    expect(rec.proposal.changed).toHaveLength(1);
    btn('[data-pact="keep"]').click();
    expect(ORIGINAL()).toContain('<small>Thanks</small>');
    expect(rec.srcDoc.querySelector('small')!.getAttribute('data-wsx-id')).toBe(String(rec.idCounter - 1));
  });

  it('blocks offer Tidy spacing and Make it a card; images offer Write alt text', () => {
    api.setSel(rec, { type: 'box', el: live('0') });
    expect([...rbody.querySelectorAll('[data-ai]')].map((b) => b.getAttribute('data-ai'))).toEqual(['tidy', 'card']);
    api.setSel(rec, { type: 'img', el: live('4') });
    expect([...rbody.querySelectorAll('[data-ai]')].map((b) => b.getAttribute('data-ai'))).toEqual(['alt']);
    api.setSel(rec, { type: 'link', el: live('2') });
    expect(rbody.querySelector('[data-ai-box]')).not.toBeNull();
  });

  it('a big page sends the nearest section only, and a whole-page reply cannot replace it', async () => {
    rec.srcDoc.querySelector('footer')!.insertAdjacentHTML('beforeend', `<p>${'x'.repeat(41000)}</p>`);
    rec.idCounter = api.stampTree(rec.srcDoc, rec.idCounter);
    const before = ORIGINAL();
    api.renderLive(rec); load();
    selectText('1');
    chat.push(done({ type: 'full_replace', message: 'Rewrote it.', html: '<html><body><section><h2>Only this</h2></section></body></html>' }));
    ask('Rewrite');
    await flush();
    const req = calls.find((c) => c.url.endsWith('/editor/chat/normal'))!;
    expect(req.body.context.htmlMode).toBe('subtree');
    expect(req.body.context.documentHtml.startsWith('<section')).toBe(true);
    expect(rec.proposal).toBeFalsy();
    expect(ORIGINAL()).toBe(before);
    expect(rbody.querySelector('.wsx-edit__aiwarn')).not.toBeNull();
  });
});
