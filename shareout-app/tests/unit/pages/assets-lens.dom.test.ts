// @vitest-environment happy-dom
//
// Recursos lens (C9/C10): a visibility badge on every workspace file, a "who can see
// these files?" choice at upload (team preselected), click-to-preview with labeled
// actions, and an in-app delete confirm instead of window.confirm.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_assets_JS as assetsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/assets';
import { workspace_client_home_views_modalsForms_JS as modalsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/modals-forms';
import { ASSETS_COPY } from '../../../src/pages/home/home-i18n/copy/assets';

const copy = { ...(ASSETS_COPY.es as Record<string, string>), 'common.delete': 'Eliminar' };
let fetchMock: ReturnType<typeof vi.fn>;

type Lens = {
  renderAssets: () => void;
  askUploadVisibility: (f: File[]) => void;
  setState: (s: unknown) => void;
};

function load(ws: string | null): Lens {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = ws;
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string | symbol, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'window') return win;
      if (prop === 't') return (k: string) => copy[k] ?? k;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      if (prop === 'isvg') return (p: string) => `<svg>${p}</svg>`;
      if (prop === 'adBytes') return (n: number) => `${n} B`;
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  const body = `with (scope) {\n${modalsJs}\n${assetsJs}\n; return { renderAssets, askUploadVisibility, setState: function (s) { ASSET_STATE = s; } }; }`;
  return new Function('scope', body)(scope);
}

const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
const dlv = (id: string, visibility: string, mimeType = 'application/pdf') => ({
  id, name: `Plano ${id}`, visibility, blobId: `b_${id}`, filename: `${id}.pdf`, mimeType, sizeBytes: 10,
  url: `/v1/files/${id}/content?v=1`, versionCount: 1, latestVersion: 1, folderId: null, usageCount: 0,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '<div id="wsxAssetMount"></div>';
  fetchMock = vi.fn(async () => json({}));
});

describe('Recursos lens', () => {
  it('badges every workspace file with who can see it, and has no hover-only icon actions', () => {
    const lens = load('wsp_1');
    lens.setState({ deliverables: [dlv('t', 'team'), dlv('p', 'private'), dlv('w', 'workspace')], loose: [] });
    lens.renderAssets();
    const badges = [...document.querySelectorAll('.wsx-asset__vis')].map((b) => b.textContent);
    expect(badges).toEqual(['Solo el equipo', 'Solo vos', 'Cualquiera con el enlace']);
    expect(document.querySelector('.wsx-asset__actions, [data-asset-act]')).toBeNull();
  });

  it('clicking a file opens a preview with labeled text actions', () => {
    const lens = load('wsp_1');
    lens.setState({ deliverables: [dlv('t', 'team', 'image/png')], loose: [] });
    lens.renderAssets();
    document.querySelector<HTMLElement>('.wsx-asset')!.click();
    const modal = document.querySelector('.wsx-modal')!;
    expect(modal.querySelector('.wsx-asset-pv__media img')).not.toBeNull();
    const labels = [...modal.querySelectorAll('.wsx-asset-pv__acts a, .wsx-asset-pv__acts button')].map((b) => b.textContent!.trim());
    for (const l of ['Descargar', 'Copiar enlace', 'Compartir', 'Mover', 'Eliminar']) expect(labels).toContain(l);
    expect((modal.querySelector('#pv_vis') as HTMLSelectElement).value).toBe('team');
  });

  it('changing visibility in the preview PATCHes the file', async () => {
    const lens = load('wsp_1');
    lens.setState({ deliverables: [dlv('t', 'team')], loose: [] });
    lens.renderAssets();
    document.querySelector<HTMLElement>('.wsx-asset')!.click();
    const sel = document.querySelector('#pv_vis') as HTMLSelectElement;
    sel.value = 'workspace';
    sel.dispatchEvent(new Event('change'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/v1/workspaces/wsp_1/assets/deliverables/t');
    expect(JSON.parse(String(init.body))).toEqual({ visibility: 'workspace' });
  });

  it('delete asks in an in-app dialog, never window.confirm', () => {
    const confirmSpy = vi.fn(() => true);
    (window as unknown as { confirm: unknown }).confirm = confirmSpy;
    const lens = load('wsp_1');
    lens.setState({ deliverables: [dlv('t', 'team')], loose: [] });
    lens.renderAssets();
    document.querySelector<HTMLElement>('.wsx-asset')!.click();
    document.querySelector<HTMLElement>('[data-pv-act="del"]')!.click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    document.querySelector<HTMLElement>('#del_go')!.click();
    expect(fetchMock.mock.calls[0]).toEqual(['/v1/workspaces/wsp_1/assets/deliverables/t', { method: 'DELETE', credentials: 'same-origin' }]);
  });

  it('a workspace upload asks who can see it (team preselected) and sends the choice', async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/upload')) return json({ data: { uploadUrl: '/put' } });
      if (url === '/put') return json({ data: { id: 'blob_1' } });
      return json({});
    });
    const lens = load('wsp_1');
    lens.askUploadVisibility([new File(['x'], 'plano.pdf', { type: 'application/pdf' })]);
    const checked = document.querySelector<HTMLInputElement>('input[name="up_vis"]:checked')!;
    expect(checked.value).toBe('team');
    expect(fetchMock).not.toHaveBeenCalled();
    document.querySelector<HTMLInputElement>('input[name="up_vis"][value="private"]')!.checked = true;
    document.querySelector<HTMLElement>('#up_go')!.click();
    for (let i = 0; i < 10; i++) await flush();
    const create = fetchMock.mock.calls.find(([u]) => u === '/v1/workspaces/wsp_1/assets/deliverables') as [string, RequestInit];
    expect(JSON.parse(String(create[1].body))).toMatchObject({ blobId: 'blob_1', name: 'plano', visibility: 'private' });
  });

  it('a personal-library upload skips the question and leaves the default to the server', async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/upload')) return json({ data: { uploadUrl: '/put' } });
      if (url === '/put') return json({ data: { id: 'blob_2' } });
      return json({});
    });
    const lens = load(null);
    lens.askUploadVisibility([new File(['x'], 'mine.pdf', { type: 'application/pdf' })]);
    expect(document.querySelector('input[name="up_vis"]')).toBeNull();
    for (let i = 0; i < 10; i++) await flush();
    const create = fetchMock.mock.calls.find(([u]) => u === '/v1/assets/deliverables') as [string, RequestInit];
    expect(JSON.parse(String(create[1].body))).toEqual({ blobId: 'blob_2', name: 'mine' });
  });
});
