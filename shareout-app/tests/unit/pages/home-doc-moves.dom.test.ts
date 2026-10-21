// @vitest-environment happy-dom
//
// The artifact / Recursos rule outside drag & drop: New → Upload routes files the same
// way, and a document can switch sides in one click (bytes kept, no copy left behind).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_drop_import_JS as dropJs } from '../../../src/pages/home/render-workspace/client-script/drop-import';
import { workspace_client_doc_moves_JS as movesJs } from '../../../src/pages/home/render-workspace/client-script/doc-moves';
import { workspace_client_new_menu_JS as newMenuJs } from '../../../src/pages/home/render-workspace/client-script/new-menu';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';
import { fetchErrorHelpers } from '../helpers/fetch-errors';

const t = (k: string) => HOME_COPY.en[k] ?? k;
const esc = (s: unknown) => (s == null ? '' : String(s));

let fetchMock: ReturnType<typeof vi.fn>;
let uploads: File[];
let toasts: Array<[string, string]>;
let opened: unknown[][];
let closed: string[];

function load(extra: Record<string, unknown> = {}) {
  document.body.innerHTML = '<div id="wsx"></div><div id="wsxAssetMount"></div>';
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_1';
  const base: Record<string, unknown> = {
    ws: document.getElementById('wsx'), newBtn: null, activeKey: 'home', curFolder: '',
    t, esc,
    fetch: (...a: unknown[]) => fetchMock(...a),
    uploadOne: (f: File, _d: unknown, cb: (ok: boolean) => void) => { uploads.push(f); cb(true); },
    showToast: (m: string, k: string) => { toasts.push([m, k]); },
    ...fetchErrorHelpers((m, k) => { toasts.push([m, k]); }),
    openArtifact: (...a: unknown[]) => { opened.push(a); },
    closeTab: (k: string) => { closed.push(k); },
    panes: { art_1: {} },
    assetApiBase: () => '/v1/workspaces/wsp_1/assets',
    fetchAssets: () => {}, reloadFolders: () => {}, agentAsk: () => {},
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
  return new Function('scope', `with (scope) {\n${dropJs}\n${movesJs}\n; return { publishFromAssets, canPublishAsset }; }`)(scope) as {
    publishFromAssets: (a: unknown) => void;
    canPublishAsset: (a: unknown) => boolean;
  };
}

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const ok = (body: unknown, init: ResponseInit = {}) => new Response(typeof body === 'string' || body instanceof Blob ? body : JSON.stringify(body), init);

beforeEach(() => { fetchMock = vi.fn(); uploads = []; toasts = []; opened = []; closed = []; });

describe('New → Upload uses the same rule as drag & drop', () => {
  it('routes picked files through importDropped(dropItems(…))', () => {
    const importDropped = vi.fn(), dropItems = vi.fn((fs: FileList) => Array.from(fs).map((f) => f.name));
    document.body.innerHTML = '<div id="wsx"></div><button id="wsxNewBtn"></button><div id="wsxNewMenu" hidden></div>';
    let picker: HTMLInputElement | null = null;
    const create = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = create(tag); if (tag === 'input') { picker = el as HTMLInputElement; vi.spyOn(picker, 'click').mockImplementation(() => {}); } return el;
    });
    const scope = { t, esc, ws: document.getElementById('wsx'), importDropped, dropItems, showToast: () => {}, setRail: () => {} };
    new Function('scope', `with (scope) {\n${newMenuJs}\n}`)(scope);
    (document.getElementById('wsxNewBtn') as HTMLButtonElement).click();
    (document.querySelector('[data-new="upload"]') as HTMLButtonElement).click();
    spy.mockRestore();
    expect(picker).not.toBeNull();
    expect(picker!.multiple).toBe(true);
    Object.defineProperty(picker!, 'files', { value: [new File(['a'], 'plan.docx'), new File(['a'], 'logo.png')] });
    picker!.dispatchEvent(new Event('change'));
    expect(dropItems).toHaveBeenCalledOnce();
    expect(importDropped).toHaveBeenCalledWith(['plan.docx', 'logo.png']);
  });
});

describe('Publish as artifact (asset → artifact)', () => {
  const asset = { id: 'dlv_1', type: 'deliverable', name: 'Budget', filename: 'Budget.xlsx', canDelete: true };

  it('is offered for every file type with a viewer', () => {
    const { canPublishAsset } = load();
    expect(canPublishAsset(asset)).toBe(true);
    expect(canPublishAsset({ ...asset, filename: 'logo.png' })).toBe(true);
    expect(canPublishAsset({ ...asset, filename: 'song.mp3' })).toBe(false);
    expect(canPublishAsset({ ...asset, type: 'loose' })).toBe(false);
  });

  it('imports the bytes as an artifact, removes the asset, and opens the result', async () => {
    const { publishFromAssets } = load();
    fetchMock
      .mockResolvedValueOnce(ok(new Blob([new Uint8Array([80, 75])])))
      .mockResolvedValueOnce(ok({ ok: true, slug: 'budget-1', name: 'Budget', artifactId: 'art_2', type: 'csv' }))
      .mockResolvedValueOnce(ok({ success: true }));
    publishFromAssets(asset);
    await settle();
    expect(fetchMock.mock.calls[0][0]).toBe('/v1/files/dlv_1/content');
    expect(fetchMock.mock.calls[1][0]).toBe('/v1/home/import?workspace=wsp_1');
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({ name: 'Budget.xlsx', content: 'UEs=', encoding: 'base64' });
    expect(fetchMock.mock.calls[2]).toEqual(['/v1/workspaces/wsp_1/assets/deliverables/dlv_1', { method: 'DELETE', credentials: 'same-origin' }]);
    expect(opened).toEqual([['budget-1', 'Budget', 'art_2', 'csv']]);
  });

  it('keeps the asset when the import is refused, and says why', async () => {
    const { publishFromAssets } = load();
    fetchMock
      .mockResolvedValueOnce(ok(new Blob(['x'])))
      .mockResolvedValueOnce(ok({ error: 'too big', code: 'SPREADSHEET_TOO_LARGE' }, { status: 413 }));
    publishFromAssets(asset);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(opened).toEqual([]);
    expect(toasts.at(-1)).toEqual([t('drop.err.sheetTooBig'), 'error']);
  });
});
