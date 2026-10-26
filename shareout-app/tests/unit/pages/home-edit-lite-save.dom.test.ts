// @vitest-environment happy-dom
//
// Quick edit save safety: Cmd/Ctrl+S saves (never publishes), a save conflict keeps the
// local edits behind a "keep mine / load newer" bar, and a publish over someone else's
// newer version is refused with a bar that shows who changed it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_edit_lite_JS as editJs } from '../../../src/pages/home/render-workspace/client-script/edit-lite';

type Rec = Record<string, unknown> & { srcDoc: Document; barEl?: HTMLElement; publishBtn: HTMLButtonElement };
type Api = { editKeydown: (rec: Rec, e: unknown) => void; autosaveDraft: (rec: Rec) => void; publishEdit: (rec: Rec, o?: unknown) => void; serializeClean: (rec: Rec) => string };
type Call = { url: string; method: string; body: Record<string, unknown> | null };

let api: Api, rec: Rec, calls: Call[], replies: Array<{ status: number; body: unknown }>, stubs: Record<string, ReturnType<typeof vi.fn>>;

const COPY: Record<string, string> = { 'edit.stale': 'Changed since you started ({info}).', 'cards.you': 'You' };
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  document.body.innerHTML = '<div class="wsx__pane"><iframe class="wsx__editframe"></iframe></div><span id="stat"></span><button id="pub"></button>';
  calls = []; replies = [];
  const srcDoc = new DOMParser().parseFromString('<!DOCTYPE html><html><head></head><body><h1 data-wsx-id="0">My edit</h1></body></html>', 'text/html');
  const pane = document.querySelector('.wsx__pane') as HTMLElement;
  rec = {
    mode: 'edit', md: null, dirty: true, srcDoc, pane, editframe: pane.querySelector('iframe'),
    art: { id: 'art_1', slug: 'demo' }, baseUpdatedAt: 'D1', baseLiveAt: 'L1', history: [], histIdx: -1,
    savestat: document.getElementById('stat'), publishBtn: document.getElementById('pub') as HTMLButtonElement,
    iframe: document.createElement('iframe'),
  };
  stubs = {
    setSaveStatus: vi.fn((r: Rec, text: string) => { (r.savestat as HTMLElement).textContent = text; }),
    renderTabs: vi.fn(), openVersionDiff: vi.fn(),
    adRelDate: vi.fn(() => '2 h ago'),
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      const next = replies.shift() || { status: 200, body: { success: true, draftUpdatedAt: 'D2' } };
      return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
    }),
  };
  const target: Record<string, unknown> = { ...stubs, metaCache: {} };
  const scope = new Proxy(target, {
    has: () => true,
    get: (tg, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in tg) return tg[prop];
      if (prop === 't') return (k: string) => COPY[k] ?? k;
      if (prop === 'tOr') return (k: string, f: string) => f;
      if (prop === 'esc') return (s: unknown) => String(s ?? '');
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
    set: (tg, prop, value) => { tg[prop as string] = value; return true; },
  });
  api = new Function('scope', `with (scope) {\n${editJs}\n; return { editKeydown: editKeydown, autosaveDraft: autosaveDraft, publishEdit: publishEdit, serializeClean: serializeClean }; }`)(scope) as Api;
});

const bar = () => rec.barEl!;
const barButtons = () => [...bar().querySelectorAll('button')].map((b) => b.textContent);
const click = (label: string) => [...bar().querySelectorAll('button')].find((b) => b.textContent === label)!.click();

describe('Cmd/Ctrl+S in quick edit', () => {
  it('saves the draft and never publishes', async () => {
    const e = { key: 's', metaKey: true, preventDefault: vi.fn() };
    api.editKeydown(rec, e);
    await flush();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(calls.map((c) => c.url)).toEqual(['/v1/artifacts/art_1/editor/draft']);
    expect(calls[0].method).toBe('POST');
    expect(rec.dirty).toBe(false);
  });

  it('with nothing unsaved, says so without a request', () => {
    rec.dirty = false;
    api.editKeydown(rec, { key: 's', ctrlKey: true, preventDefault: () => {} });
    expect(calls).toHaveLength(0);
    expect(stubs.setSaveStatus).toHaveBeenLastCalledWith(rec, 'edit.allSaved', 'ok');
  });
});

describe('a save conflict', () => {
  it('keeps the local edits and asks which to keep', async () => {
    const before = api.serializeClean(rec);
    replies.push({ status: 409, body: { success: false, code: 'DRAFT_CONFLICT', currentUpdatedAt: 'D9' } });
    api.autosaveDraft(rec);
    await flush();
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(0);
    expect(api.serializeClean(rec)).toBe(before);
    expect(rec.dirty).toBe(true);
    expect(bar().hidden).toBe(false);
    expect(bar().textContent).toContain('edit.conflict');
    expect(barButtons()).toEqual(['edit.keepMine', 'edit.loadNewer']);

    // Autosave pauses while the bar is up.
    api.autosaveDraft(rec);
    await flush();
    expect(calls).toHaveLength(1);

    click('edit.keepMine');
    await flush();
    expect(calls[1].url).toBe('/v1/artifacts/art_1/editor/draft');
    expect(calls[1].body!.baseUpdatedAt).toBe('D9');
    expect(calls[1].body!.resetBase).toBe(true);
    expect(calls[1].body!.html).toBe(before);
    expect(bar().hidden).toBe(true);
  });

  it('"Load newer" reloads the draft, dropping local edits only on request', async () => {
    replies.push({ status: 409, body: { success: false, code: 'DRAFT_CONFLICT', currentUpdatedAt: 'D9' } });
    api.autosaveDraft(rec);
    await flush();
    click('edit.loadNewer');
    expect(rec.dirty).toBe(false);
    expect(calls[1]).toMatchObject({ url: '/v1/artifacts/art_1/editor', method: 'GET' });
    expect(bar().hidden).toBe(true);
  });

  it('a publish conflict keeps the edits too, and "Keep mine" continues the publish', async () => {
    replies.push({ status: 409, body: { success: false, code: 'DRAFT_CONFLICT', currentUpdatedAt: 'D9' } });
    api.publishEdit(rec);
    await flush();
    expect(rec.publishBtn.disabled).toBe(false);
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(0);
    replies.push({ status: 200, body: { success: true, versionNo: 4, liveUpdatedAt: 'L4' } });
    click('edit.keepMine');
    await flush();
    expect(calls[1].url).toBe('/v1/artifacts/art_1/editor/publish');
    expect(calls[1].body!.baseUpdatedAt).toBe('D9');
    expect(rec.baseLiveAt).toBe('L4');
  });
});

describe('an out-of-date publish', () => {
  const stale = { success: false, code: 'STALE_BASE', live: { versionNo: 14, updatedAt: '2026-10-25T10:00:00Z', by: 'Ana', byYou: false, source: 'api' }, baseVersionNo: 12 };

  it('sends the base it started from and shows who changed the page', async () => {
    replies.push({ status: 409, body: stale });
    api.publishEdit(rec);
    await flush();
    expect(calls[0].body!.baseLiveAt).toBe('L1');
    expect(bar().querySelector('.wsx-editbar__msg')!.textContent).toBe('Changed since you started (v14 · Ana · 2 h ago).');
    expect(barButtons()).toEqual(['edit.seeChanges', 'edit.publishAnyway', '×']);
    expect(rec.publishBtn.disabled).toBe(false);
  });

  it('"See what changed" opens the history diff from the base to the live version', async () => {
    replies.push({ status: 409, body: stale });
    api.publishEdit(rec);
    await flush();
    click('edit.seeChanges');
    expect(stubs.openVersionDiff).toHaveBeenCalledWith(rec.art, 12, 14);
  });

  it('"Publish anyway" publishes without the base', async () => {
    replies.push({ status: 409, body: stale });
    api.publishEdit(rec);
    await flush();
    replies.push({ status: 200, body: { success: true, versionNo: 15, liveUpdatedAt: 'L15' } });
    click('edit.publishAnyway');
    await flush();
    expect(calls[1].url).toBe('/v1/artifacts/art_1/editor/publish');
    expect(calls[1].body!.baseLiveAt).toBeUndefined();
    expect(rec.baseLiveAt).toBe('L15');
    expect(bar().hidden).toBe(true);
  });

  it('names you when the newer version is yours, and hides the diff without a base', async () => {
    replies.push({ status: 409, body: { ...stale, live: { ...stale.live, byYou: true }, baseVersionNo: null } });
    api.publishEdit(rec);
    await flush();
    expect(bar().textContent).toContain('v14 · You');
    expect(barButtons()).toEqual(['edit.publishAnyway', '×']);
  });
});
