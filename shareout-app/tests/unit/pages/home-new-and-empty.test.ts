// @vitest-environment happy-dom
//
// Studio "New" menu (role-gated, no AI) and the honest empty states a non-technical
// member meets: Catalog, Knowledge KPIs, and the first tab naming the real section.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWorkspaceBody } from '../../../src/pages/home/render-workspace/template';
import { workspace_client_new_menu_JS as newMenuJs } from '../../../src/pages/home/render-workspace/client-script/new-menu';
import { workspace_client_preamble_JS as preambleJs } from '../../../src/pages/home/render-workspace/client-script/preamble';
import { workspace_client_inspector_JS as inspectorJs } from '../../../src/pages/home/render-workspace/client-script/inspector';
import { workspace_client_home_views_catalog_JS as catalogJs } from '../../../src/pages/home/render-workspace/client-script/home-views/catalog';
import { workspace_client_home_views_knowledge_JS as knowledgeJs } from '../../../src/pages/home/render-workspace/client-script/home-views/knowledge';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';
import type { RenderArgs } from '../../../src/pages/home/types';
import { fetchErrorHelpers } from '../helpers/fetch-errors';

let locale: 'en' | 'es' = 'en';
const t = (k: string) => HOME_COPY[locale][k] ?? k;
const esc = (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
const emptyStateJs = between(preambleJs, 'function emptyState', '  // Error state');

function load<T>(js: string, names: string[], extra: Record<string, unknown> = {}): T {
  const win = globalThis.window as unknown as Record<string, unknown>;
  const scope = new Proxy({} as Record<string | symbol, unknown>, {
    has: () => true,
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop in extra) return extra[prop];
      if (prop === 'window') return win;
      if (prop === 'document') return document;
      if (prop === 't') return t;
      if (prop === 'esc') return esc;
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
    set: (target, prop, value) => { target[prop as string] = value; return true; },
  });
  const body = `with (scope) {\n${emptyStateJs}\n${js}\n; return { ${names.map((n) => `${n}: ${n}`).join(', ')} }; }`;
  return new Function('scope', body)(scope) as T;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  locale = 'en';
  document.body.innerHTML = '';
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_test';
  win.WSX_ADMIN = false;
});

describe('New button — only where the viewer can create', () => {
  const base = { user: { id: 'u', email: null }, userInfo: null, workspaces: [], workspace: '', workspaceId: null, workspaceRole: null, createEnabled: false } as unknown as RenderArgs;
  const has = (a: Partial<RenderArgs>) => buildWorkspaceBody({ ...base, ...a } as RenderArgs).includes('id="wsxNewBtn"');

  it('shows in the personal space and for every internal role', () => {
    expect(has({})).toBe(true);
    for (const role of ['owner', 'admin', 'member']) expect(has({ workspaceId: 'wsp_1', workspaceRole: role })).toBe(true);
  });

  it('hides in a workspace the viewer is not an internal member of (the API would 403)', () => {
    expect(has({ workspaceId: 'wsp_1', workspaceRole: null })).toBe(false);
    expect(has({ workspace: 'wsp_1', workspaceRole: null })).toBe(false);
  });

  it('does not depend on AI: present with Create with AI off, and Create with AI stays gated', () => {
    const off = buildWorkspaceBody({ ...base, workspaceId: 'wsp_1', workspaceRole: 'member', createEnabled: false } as RenderArgs);
    expect(off).toContain('id="wsxNewBtn"');
    expect(off).not.toContain('id="wsxCreateBtn"');
  });
});

describe('New menu', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let opened: unknown[];
  let edited: unknown[];
  const panes: Record<string, unknown> = {};

  function setup() {
    document.body.innerHTML = '<div id="wsx"><div data-lens="assets"></div><button id="wsxAssetUpload"></button></div><button id="wsxNewBtn" aria-expanded="false"></button><div id="wsxNewMenu" hidden></div>';
    fetchMock = vi.fn();
    opened = []; edited = [];
    const ws = document.getElementById('wsx');
    load(newMenuJs, [], {
      ws,
      panes,
      fetch: (...a: unknown[]) => fetchMock(...a),
      showToast: () => {},
      ...fetchErrorHelpers(() => {}),
      openArtifact: (...a: unknown[]) => { opened = a; panes[String(a[2])] = { id: a[2] }; },
      setEditMode: (...a: unknown[]) => { edited = a; },
    });
  }
  const items = () => Array.from(document.querySelectorAll('#wsxNewMenu [role="menuitem"]')).map((b) => b.firstChild!.textContent);

  it('offers upload, blank document and template — in plain Spanish', () => {
    locale = 'es';
    setup();
    (document.getElementById('wsxNewBtn') as HTMLButtonElement).click();
    expect(document.getElementById('wsxNewMenu')!.hidden).toBe(false);
    expect(items()).toEqual(['Subir archivos', 'Documento en blanco', 'Desde una plantilla', 'Ver plantillas']);
    (document.querySelector('[data-new="tpl"]') as HTMLButtonElement).click();
    expect(items()).toEqual(['Informe', 'Minuta de reunión', 'Propuesta']);
  });

  it('creates from a template in the current workspace and opens it in Edit', async () => {
    locale = 'es';
    (globalThis.window as unknown as Record<string, unknown>).__SO_HOME_LOCALE = () => 'es';
    setup();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, artifactId: 'art_9', slug: 'minuta-abc', name: 'Minuta de reunión' })));
    (document.getElementById('wsxNewBtn') as HTMLButtonElement).click();
    (document.querySelector('[data-new="tpl"]') as HTMLButtonElement).click();
    (document.querySelector('[data-new="tpl:meeting"]') as HTMLButtonElement).click();
    expect(document.getElementById('wsxNewMenu')!.hidden).toBe(true);
    await flush(); await flush();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/v1/home/new?workspace=wsp_test');
    expect(JSON.parse(String(init.body))).toEqual({ template: 'meeting', lang: 'es' });
    expect(opened).toEqual(['minuta-abc', 'Minuta de reunión', 'art_9']);
    expect(edited[1]).toBe('edit');
  });

  it('"Upload files" opens a picker on the spot, without jumping to Assets', () => {
    setup();
    const lens = vi.fn(), assetPick = vi.fn(), pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    document.querySelector('[data-lens="assets"]')!.addEventListener('click', lens);
    document.getElementById('wsxAssetUpload')!.addEventListener('click', assetPick);
    (document.getElementById('wsxNewBtn') as HTMLButtonElement).click();
    (document.querySelector('[data-new="upload"]') as HTMLButtonElement).click();
    expect(pick).toHaveBeenCalledOnce();
    expect(lens).not.toHaveBeenCalled();
    expect(assetPick).not.toHaveBeenCalled();
    pick.mockRestore();
  });
});

describe('Catalog empty state', () => {
  function render(admin: boolean) {
    (globalThis.window as unknown as Record<string, unknown>).WSX_ADMIN = admin;
    locale = 'es';
    document.body.innerHTML = '<div id="m"></div>';
    const lens = load<{ catRenderOnboard: (m: HTMLElement, mode: string) => void }>(catalogJs, ['catRenderOnboard']);
    lens.catRenderOnboard(document.getElementById('m')!, 'empty');
    return document.getElementById('m')!;
  }

  it('tells a member what will show up — no contradictory "ask an admin to turn it on"', () => {
    const m = render(false);
    expect(m.textContent).toContain('Todavía no hay datos catalogados.');
    expect(m.textContent).toContain('Cuando tu equipo conecte una fuente de datos, la vas a ver acá.');
    expect(m.textContent).not.toContain(t('catalog.emptyTitle'));
    expect(m.textContent).not.toContain(t('catalog.askAdmin'));
    expect(m.querySelector('button')).toBeNull();
  });

  it('keeps the admin path (seed from connectors)', () => {
    const m = render(true);
    expect(m.textContent).toContain(t('catalog.emptyTitle'));
    expect(m.querySelector('#catSeed')).not.toBeNull();
  });
});

describe('Knowledge KPI tiles', () => {
  it('does not show "0 pages learned" next to real entities', () => {
    const lens = load<{ knState: { counts: Record<string, number>; lastUpdated: string }; knKpiTiles: () => string }>(knowledgeJs, ['knState', 'knKpiTiles'], { kmEntityTotal: () => 0 });
    lens.knState.counts = { entity: 8 };
    lens.knState.lastUpdated = '';
    document.body.innerHTML = lens.knKpiTiles();
    const labels = Array.from(document.querySelectorAll('.wsx-an__l')).map((l) => l.textContent);
    expect(labels).toEqual([t('knowledge.kpiEntities')]);
  });
});

describe('First tab names the section you are in', () => {
  const fn = between(inspectorJs, 'function homeTabLabel', '  function renderTabs');
  function label(active: string | null) {
    document.body.innerHTML = '<div id="wsx">' + ['brief', 'artifacts', 'assets'].map((k) => `<button data-lens="${k}"${k === active ? ' class="is-active"' : ''}></button>`).join('') + '</div>';
    return load<{ homeTabLabel: () => string }>(fn, ['homeTabLabel'], { ws: document.getElementById('wsx') }).homeTabLabel();
  }

  it('says Inicio on Home and the section name elsewhere', () => {
    locale = 'es';
    expect(label('brief')).toBe('Inicio');
    expect(label(null)).toBe('Inicio');
    expect(label('artifacts')).toBe('Artefactos');
    expect(label('assets')).toBe('Recursos');
  });
});
