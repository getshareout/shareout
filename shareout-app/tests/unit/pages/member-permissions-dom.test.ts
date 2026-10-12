// @vitest-environment happy-dom
//
// Role-based visibility in the Home shell: a plain member never sees controls the API
// would refuse (Edit, Move to Trash, Delete file, Connect a source), owners/admins keep
// them, and a failed comment keeps the typed text with a clear error.
import { beforeEach, describe, expect, it } from 'vitest';
import { workspace_client_inspector_JS as inspectorJs } from '../../../src/pages/home/render-workspace/client-script/inspector';
import { workspace_client_home_views_connectors_JS as connectorsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/connectors';
import { workspace_client_home_views_assets_JS as assetsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/assets';

type Fn = (...a: unknown[]) => unknown;
let fetchImpl: Fn = () => new Promise(() => {});

/** Evaluate a client-script chunk with every free identifier stubbed (see admin-lens-smoke). */
function load(src: string, names: string[]): Record<string, Fn> {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_1';
  const blackhole: unknown = new Proxy(function () {}, {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => '' : blackhole),
    apply: () => blackhole,
    construct: () => blackhole as object,
  });
  // `var x = …` inside with(scope) assigns through the proxy, so keep those writes.
  const store: Record<string, unknown> = {};
  const scope = new Proxy({}, {
    has: () => true,
    set: (_t, prop, v) => { store[prop as string] = v; return true; },
    get: (_t, prop) => {
      if (typeof prop === 'symbol') return prop === Symbol.unscopables ? undefined : blackhole;
      if (prop in store) return store[prop];
      if (prop === 'window') return win;
      if (prop === 'document') return globalThis.document;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s));
      if (prop === 't') return (k: unknown) => String(k);
      if (prop === 'fetch') return (...a: unknown[]) => fetchImpl(...a);
      if (prop === 'loadSecOrder') return () => ['description'];
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return blackhole;
    },
  });
  const body = `with (scope) {\n${src}\n; return { ${names.map((n) => `${n}: ${n}`).join(', ')} }; }`;
  return new Function('scope', body)(scope);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fetchImpl = () => new Promise(() => {});
  document.body.innerHTML = '<div id="wsxRtabs"></div><div id="wsxRbody"></div>';
});

describe('Inspector details — role-based actions', () => {
  const art = { key: 'art_1', id: 'art_1', slug: 'glosario', name: 'Glosario' };
  const meta = { id: 'art_1', name: 'Glosario', slug: 'glosario', visibility: 'workspace', workspace_id: 'wsp_1', tags: [] };

  it('a member sees the real visibility and no Edit / Trash', () => {
    const { paintDetails } = load(inspectorJs, ['paintDetails']);
    paintDetails(art, { ...meta, can_edit: false, can_delete: false });
    const body = document.getElementById('wsxRbody')!;
    expect(body.querySelector('[data-iact="edit"]')).toBeNull();
    expect(body.querySelector('[data-iact="trash"]')).toBeNull();
    expect(body.querySelector('[data-iact="open"]')).not.toBeNull();
    expect(body.querySelector('#wsxVisSeg')).toBeNull();
    expect(body.textContent).toContain('inspector.visName.workspace');
  });

  it('the owner keeps Edit and Trash', () => {
    const { paintDetails } = load(inspectorJs, ['paintDetails']);
    paintDetails(art, { ...meta, can_edit: true, can_delete: true });
    const body = document.getElementById('wsxRbody')!;
    expect(body.querySelector('[data-iact="edit"]')).not.toBeNull();
    expect(body.querySelector('[data-iact="trash"]')).not.toBeNull();
  });

  it('a workspace admin can trash without an edit control', () => {
    const { paintDetails } = load(inspectorJs, ['paintDetails']);
    paintDetails(art, { ...meta, can_edit: false, can_delete: true });
    const body = document.getElementById('wsxRbody')!;
    expect(body.querySelector('[data-iact="edit"]')).toBeNull();
    expect(body.querySelector('[data-iact="trash"]')).not.toBeNull();
  });
});

describe('Inspector comments — failed send', () => {
  function setup() {
    const fns = load(inspectorJs, ['composerHTML', 'postComment']);
    document.body.innerHTML = fns.composerHTML(false) as string;
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    const btn = document.querySelector('.js-send') as HTMLButtonElement;
    ta.value = 'hola equipo';
    return { ...fns, ta, btn, err: document.querySelector('.wsx-cc__err') as HTMLElement };
  }

  it('keeps the text and explains a 403', async () => {
    fetchImpl = async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    const { postComment, ta, btn, err } = setup();
    postComment({ id: 'art_1' }, ta.value, null, btn, ta);
    await flush(); await flush();
    expect(ta.value).toBe('hola equipo');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe('inspector.cannotComment');
  });

  it('keeps the text on a network error', async () => {
    fetchImpl = async () => { throw new Error('offline'); };
    const { postComment, ta, btn, err } = setup();
    postComment({ id: 'art_1' }, ta.value, null, btn, ta);
    await flush(); await flush();
    expect(ta.value).toBe('hola equipo');
    expect(err.textContent).toBe('inspector.couldNotPost');
    expect(btn.disabled).toBe(false);
  });
});

describe('Data sources — Connect is admin-only', () => {
  const provider = { id: 'gsheets', label: 'Google Sheets', connections: [] };

  it('a member gets an ask-your-admin note instead of Connect', () => {
    const { connCard } = load(connectorsJs, ['connCard']);
    document.body.innerHTML = connCard(provider, false) as string;
    expect(document.querySelector('[data-conn-add]')).toBeNull();
    expect(document.body.textContent).toContain('connectors.askAdmin');
  });

  it('an admin can connect and remove', () => {
    const { connCard } = load(connectorsJs, ['connCard']);
    document.body.innerHTML = connCard({ ...provider, connections: [{ id: 'c1', name: 'Ventas' }] }, true) as string;
    expect(document.querySelector('[data-conn-add]')).not.toBeNull();
    expect(document.querySelector('[data-conn-del]')).not.toBeNull();
  });
});

describe('Files — Delete follows canDelete', () => {
  const file = { id: 'dlv_1', type: 'deliverable', name: 'Logo', filename: 'logo.png', mimeType: 'image/png', url: '/f', versionCount: 1, visibility: 'workspace' };

  it.each([[false, 0], [true, 1]])('canDelete=%s → %i delete buttons', (canDelete, n) => {
    const { assetTile } = load(assetsJs, ['assetTile']);
    document.body.innerHTML = assetTile({ ...file, canDelete }) as string;
    expect(document.querySelectorAll('[data-asset-act="del"]').length).toBe(n);
  });
});
