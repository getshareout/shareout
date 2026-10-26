// @vitest-environment happy-dom
//
// Guest comments switches: the folder access panel (folder managers only) and the
// Follow folder / On / Off control in an artifact's Comments tab (owner only).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_artifactsBrowser_JS as BROWSER } from '../../../src/pages/home/render-workspace/client-script/home-views/artifacts-browser';
import { workspace_client_guest_comments_JS as GUEST_BOOT, workspace_client_guest_comments_lazy_JS as GUEST_LAZY } from '../../../src/pages/home/render-workspace/client-script/guest-comments';

const GUEST = GUEST_BOOT + GUEST_LAZY;
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

const t = (k: string) => HOME_COPY.en[k] ?? k;
const esc = (s: unknown) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'));
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
let toasts: Array<[string, string]>;

function scopeFor(base: Record<string, unknown>) {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_1';
  win.showToast = (m: string, k: string) => { toasts.push([m, k]); };
  return new Proxy({} as Record<string | symbol, unknown>, {
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
}

function browserData(canEditFolder: boolean) {
  return {
    cardsHtml: '', rowsHtml: '', foldersHtml: '', folderName: 'Reports', folderPath: [{ id: 'fld_1', name: 'Reports' }],
    canManageFolders: canEditFolder, canEditFolder, folderScope: 'workspace',
    folderAccess: { access: 'workspace', effective: 'workspace', visibility: 'inherit', grants: [], moreOpen: { public: 0, workspace: 0 } },
  };
}

async function openPanel(_canEditFolder: boolean) {
  document.body.innerHTML = '<div id="wsx"><div id="home"></div><div id="wsxArtMount"></div></div><div id="modal"></div>';
  const base: Record<string, unknown> = {
    homePane: document.getElementById('home'), ws: document.getElementById('wsx'),
    t, esc, fetch: (...a: unknown[]) => fetchMock(...a),
    i18nLoad: () => '', i18nEmpty: (k: string) => k, renderArtView: () => {}, ART_DATA: {},
    wsxModal: (_title: string, html: string) => { document.getElementById('modal')!.innerHTML = html; return {}; },
    optimistic: () => {}, okOr: (r: Response) => r, fld: () => '', cv: () => '', adRelDate: (s: string) => s, errReason: () => '',
    requestIdleCallback: () => {},
  };
  new Function('scope', `with (scope) {\n${GUEST}\n${BROWSER}\n}`)(scopeFor(base));
  const win = globalThis.window as unknown as { enterFolder: (id: string, n: string) => void; openFolderAccess: () => void };
  win.enterFolder('fld_1', 'Reports');
  await settle();
  win.openFolderAccess();
  await settle();
}

function folderRouter(guestComments: boolean, putStatus = 200) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith('/v1/home/browser')) return Promise.resolve(res(browserData(canEdit)));
    if (url.endsWith('/guest-comments')) {
      if (init?.method === 'PUT') return Promise.resolve(res(putStatus === 200 ? { folder_id: 'fld_1', guest_comments: true } : { error: 'Forbidden', code: 'FORBIDDEN' }, putStatus));
      return Promise.resolve(res({ folder_id: 'fld_1', guest_comments: guestComments }));
    }
    return Promise.resolve(res({ activity: [] }));
  });
}
let canEdit = true;

beforeEach(() => { fetchMock = vi.fn(); toasts = []; canEdit = true; });

describe('folder access panel: Allow guest comments', () => {
  it('shows the switch with its current state and the explanation to a folder manager', async () => {
    folderRouter(true);
    await openPanel(true);
    const inp = document.getElementById('fa_guest_in') as HTMLInputElement;
    expect(inp).not.toBeNull();
    expect(inp.getAttribute('role')).toBe('switch');
    expect(inp.checked).toBe(true);
    expect(inp.disabled).toBe(false);
    expect(document.getElementById('fa_guest')!.textContent).toContain(t('guestComments.folderNote'));
    expect(fetchMock.mock.calls.some((c) => c[0] === '/v1/workspaces/wsp_1/folders/fld_1/guest-comments')).toBe(true);
  });

  it('is hidden from people who cannot manage the folder, and never fetched', async () => {
    canEdit = false;
    folderRouter(true);
    await openPanel(false);
    expect(document.getElementById('fa_body')!.innerHTML).not.toBe('');
    expect(document.getElementById('fa_guest')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/guest-comments'))).toBe(false);
  });

  it('PUTs { enabled } when switched', async () => {
    folderRouter(false);
    await openPanel(true);
    const inp = document.getElementById('fa_guest_in') as HTMLInputElement;
    expect(inp.checked).toBe(false);
    inp.checked = true; inp.dispatchEvent(new Event('change'));
    await settle();
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(put![0]).toBe('/v1/workspaces/wsp_1/folders/fld_1/guest-comments');
    expect(JSON.parse(put![1].body)).toEqual({ enabled: true });
    expect(toasts).toEqual([]);
  });

  it('rolls back and shows an error toast on 403', async () => {
    folderRouter(false, 403);
    await openPanel(true);
    const inp = document.getElementById('fa_guest_in') as HTMLInputElement;
    inp.checked = true; inp.dispatchEvent(new Event('change'));
    await settle();
    expect(inp.checked).toBe(false);
    expect(toasts).toEqual([[t('guestComments.forbiddenFolder'), 'error']]);
  });
});

describe('Comments tab: guest comments Follow folder / On / Off', () => {
  function load() {
    return new Function('scope', `with (scope) {\n${GUEST}\n; return { gcArtHtml: gcArtHtml, wireGuestArt: wireGuestArt }; }`)(scopeFor({ t, esc, fetch: (...a: unknown[]) => fetchMock(...a) })) as {
      gcArtHtml: (art: unknown, meta: unknown) => string;
      wireGuestArt: (art: unknown) => void;
    };
  }
  const art = { id: 'art_1', slug: 'plan' };
  function artRouter(cfg: Record<string, unknown>, put: { status: number; effective?: boolean } = { status: 200 }) {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return Promise.resolve(put.status === 200
          ? res({ success: true, data: { ...cfg, guestCommentsEffective: put.effective } })
          : res({ success: false, error: { code: 'FORBIDDEN' } }, put.status));
      }
      return Promise.resolve(res({ success: true, data: cfg }));
    });
  }
  async function mount(meta: Record<string, unknown>) {
    const { gcArtHtml, wireGuestArt } = load();
    document.body.innerHTML = '<div class="wsx-cm">' + gcArtHtml(art, meta) + '</div>';
    wireGuestArt(art);
    await settle();
  }
  const selected = () => (document.querySelector('[data-gc][aria-checked="true"]') as HTMLElement | null)?.getAttribute('data-gc');
  const now = () => document.getElementById('wsxGuestCmNow')!.textContent;

  it('shows the owner the current mode and the effective state', async () => {
    artRouter({ enabled: true, guestCommentsEffective: true });
    await mount({ can_manage_comments: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/v1/data/art_1/comments/_config');
    expect(selected()).toBe('follow');
    expect(now()).toBe(t('guestComments.nowOnFolder'));
  });

  it('is hidden from anyone who is not the owner', async () => {
    artRouter({ enabled: true, guestCommentsEffective: true });
    await mount({ can_manage_comments: false, can_edit: true });
    expect(document.getElementById('wsxGuestCm')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUTs guestComments true / null and shows the new effective state', async () => {
    artRouter({ enabled: true, guestComments: false, guestCommentsEffective: false }, { status: 200, effective: true });
    await mount({ can_manage_comments: true });
    expect(selected()).toBe('off');
    expect(now()).toBe(t('guestComments.nowOff'));
    (document.querySelector('[data-gc="on"]') as HTMLButtonElement).click();
    await settle();
    let put = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PUT').at(-1)!;
    expect(put[0]).toBe('/v1/data/art_1/comments/_config');
    expect(JSON.parse(put[1].body)).toEqual({ guestComments: true });
    expect(selected()).toBe('on');
    expect(now()).toBe(t('guestComments.nowOn'));
    (document.querySelector('[data-gc="follow"]') as HTMLButtonElement).click();
    await settle();
    put = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PUT').at(-1)!;
    expect(JSON.parse(put[1].body)).toEqual({ guestComments: null });
    expect(selected()).toBe('follow');
  });

  it('rolls back and shows an error toast on 403', async () => {
    artRouter({ enabled: true, guestCommentsEffective: false }, { status: 403 });
    await mount({ can_manage_comments: true });
    (document.querySelector('[data-gc="on"]') as HTMLButtonElement).click();
    await settle();
    expect(selected()).toBe('follow');
    expect(now()).toBe(t('guestComments.nowOffFolder'));
    expect(toasts).toEqual([[t('guestComments.forbiddenArtifact'), 'error']]);
  });
});
