// @vitest-environment happy-dom
//
// Studio Home one-step import (client): drop/paste routing, multi-file progress,
// per-file errors, open + "make it live" hand-off.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_drop_import_JS as dropJs } from '../../../src/pages/home/render-workspace/client-script/drop-import';
import { WORKSPACE_CLIENT } from '../../../src/pages/home/render-workspace/client-script/index';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

const t = (k: string) => HOME_COPY.en[k] ?? k;
const esc = (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const flush = () => new Promise((r) => setTimeout(r, 0));

let fetchMock: ReturnType<typeof vi.fn>;
let uploads: string[];
let opened: unknown[][];
let asked: string[];
let reloaded: number;

function load(extra: Record<string, unknown> = {}) {
  document.body.innerHTML = '<div id="wsx"></div><button id="wsxNewBtn"></button>';
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_1';
  const base: Record<string, unknown> = {
    ws: document.getElementById('wsx'),
    newBtn: document.getElementById('wsxNewBtn'),
    activeKey: 'home',
    curFolder: 'fld_1',
    t, esc,
    fetch: (...a: unknown[]) => fetchMock(...a),
    uploadOne: (f: File, _d: unknown, cb: (ok: boolean) => void) => { uploads.push(f.name); cb(true); },
    openArtifact: (...a: unknown[]) => { opened.push(a); },
    agentAsk: (s: string) => { asked.push(s); },
    reloadFolders: () => { reloaded++; },
    ...extra,
  };
  const scope = new Proxy({} as Record<string | symbol, unknown>, {
    has: () => true,
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop in base) return base[prop];
      if (prop === 'window') return win;
      if (prop === 'document') return document;
      return (globalThis as Record<string, unknown>)[prop];
    },
    set: (target, prop, value) => { target[prop as string] = value; return true; },
  });
  return new Function('scope', `with (scope) {\n${dropJs}\n; return { importDropped, dropItems }; }`)(scope) as {
    importDropped: (items: unknown[]) => Promise<void>;
    dropItems: (files: File[]) => Array<{ kind: string; label: string }>;
  };
}

function okJson(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status }); }
const rows = () => Array.from(document.querySelectorAll('.wsx-drop__row')).map((r) => [r.querySelector('.wsx-drop__name')!.textContent, r.getAttribute('data-state'), r.querySelector('.wsx-drop__st')!.textContent]);

function paste(data: { text?: string; files?: File[] }) {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { files: data.files || [], getData: () => data.text || '' } });
  document.body.dispatchEvent(e);
  return e;
}

// Each load() wires a document-level paste listener; drop the previous test's.
const docListeners: Array<[string, EventListener]> = [];
const addDocListener = document.addEventListener.bind(document);
document.addEventListener = ((type: string, fn: EventListener) => { docListeners.push([type, fn]); addDocListener(type, fn); }) as typeof document.addEventListener;

beforeEach(() => {
  for (const [type, fn] of docListeners.splice(0)) document.removeEventListener(type, fn);
  fetchMock = vi.fn(); uploads = []; opened = []; asked = []; reloaded = 0;
});

describe('drop routing', () => {
  it('sends viewer types to /v1/home/import and images/other files to Assets', () => {
    const { dropItems } = load();
    const kinds = dropItems([new File(['a'], 'v.csv'), new File(['a'], 'p.HTML'), new File(['a'], 'd.pdf'), new File(['a'], 'logo.png'), new File(['a'], 'x.xlsx')]);
    expect(kinds.map((k) => k.kind)).toEqual(['file', 'file', 'file', 'asset', 'asset']);
  });

  it('imports several files in order with per-file status, into the current workspace + folder', async () => {
    const { importDropped, dropItems } = load();
    fetchMock
      .mockResolvedValueOnce(okJson({ ok: true, slug: 's1', name: 'ventas', artifactId: 'art_1', type: 'csv' }))
      .mockResolvedValueOnce(okJson({ error: 'Daily publish limit reached', code: 'RATE_LIMIT_EXCEEDED' }, 429));
    await importDropped(dropItems([new File(['a,b'], 'ventas.csv'), new File(['<p>'], 'page.html'), new File(['x'], 'logo.png')]));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/v1/home/import?workspace=wsp_1');
    expect(JSON.parse(String(init.body))).toMatchObject({ name: 'ventas.csv', content: 'a,b', folder: 'fld_1' });
    expect(rows()).toEqual([
      ['ventas.csv', 'ok', t('drop.done')],
      ['page.html', 'err', t('drop.err.limit')],
      ['logo.png', 'ok', t('drop.toAssets')],
    ]);
    expect(uploads).toEqual(['logo.png']);
    expect(reloaded).toBe(1);
    expect(opened).toEqual([]); // several items: nothing auto-opens
  });

  it('shows quota, type and size errors clearly', async () => {
    const { importDropped } = load();
    fetchMock.mockResolvedValueOnce(okJson({ error: 'Storage limit', code: 'STORAGE_LIMIT_EXCEEDED' }, 413));
    const big = new File(['x'], 'big.csv'); Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    await importDropped([{ kind: 'file', file: new File(['a'], 'a.csv'), label: 'a.csv' }, { kind: 'file', file: big, label: 'big.csv' }]);
    expect(rows().map((r) => r[2])).toEqual([t('drop.err.quota'), t('drop.err.tooBig').replace('{mb}', '25')]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('opens a single published item and offers "make it live" via the chat agent', async () => {
    const { importDropped, dropItems } = load();
    fetchMock.mockResolvedValueOnce(okJson({ ok: true, slug: 's1', name: 'Q3', artifactId: 'art_9', type: 'html' }));
    await importDropped(dropItems([new File(['<p>'], 'q3.html')]));
    expect(opened).toEqual([['s1', 'Q3', 'art_9']]);
    (document.querySelector('[data-drop="live"]') as HTMLButtonElement).click();
    expect(asked[0]).toContain('"Q3" (art_9)');
  });

  it('labels a moderation hold and offers no "live" for a PDF', async () => {
    const { importDropped, dropItems } = load();
    fetchMock.mockResolvedValueOnce(okJson({ ok: true, slug: 's', name: 'd', artifactId: 'a', type: 'pdf', moderation: { status: 'pending' } }));
    await importDropped(dropItems([new File(['%PDF'], 'd.pdf')]));
    expect(rows()[0][1]).toBe('warn');
    expect(document.querySelector('[data-drop="live"]')).toBeNull();
  });
});

describe('paste', () => {
  it('publishes pasted HTML source', async () => {
    load();
    fetchMock.mockResolvedValue(okJson({ ok: true, slug: 's', name: 'n', artifactId: 'a', type: 'html' }));
    const e = paste({ text: '<!DOCTYPE html><html><body>hi</body></html>' });
    expect(e.defaultPrevented).toBe(true);
    await flush(); await flush();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).html).toContain('<body>hi</body>');
  });

  it('sends a chat-app share link to the server and shows the copy-the-HTML fallback', async () => {
    load();
    fetchMock.mockResolvedValue(okJson({ error: 'nope', code: 'URL_NOT_FETCHABLE' }, 422));
    paste({ text: 'https://claude.ai/public/artifacts/abc' });
    await flush(); await flush(); await flush();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).url).toBe('https://claude.ai/public/artifacts/abc');
    expect(rows()[0][2]).toBe(t('drop.err.url'));
  });

  it('leaves ordinary text, other links, typing in a field, and artifact tabs alone', () => {
    load();
    expect(paste({ text: 'just some words' }).defaultPrevented).toBe(false);
    expect(paste({ text: 'https://example.com/x' }).defaultPrevented).toBe(false);
    const input = document.createElement('textarea'); document.body.appendChild(input); input.focus();
    expect(paste({ text: '<html><body>x</body></html>' }).defaultPrevented).toBe(false);
    input.remove();
    for (const [type, fn] of docListeners.splice(0)) document.removeEventListener(type, fn);
    load({ activeKey: 'art_1' });
    expect(paste({ text: '<html><body>x</body></html>' }).defaultPrevented).toBe(false);
  });

  it('is not wired where the viewer cannot create (no New button)', () => {
    load({ newBtn: null });
    expect(paste({ text: '<html><body>x</body></html>' }).defaultPrevented).toBe(false);
  });
});

describe('bundle', () => {
  it('ships in the workspace client after the New menu', () => {
    expect(WORKSPACE_CLIENT.indexOf('One-step import')).toBeGreaterThan(WORKSPACE_CLIENT.indexOf('===== New menu'));
    expect(() => new Function(WORKSPACE_CLIENT)).not.toThrow();
  });
});
