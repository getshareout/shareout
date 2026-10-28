// @vitest-environment happy-dom
//
// Catalog lens edit form: any member opens an entry, clicks Edit, changes fields and saves.
// Only changed fields go to PATCH …/entries/{id}; the detail then shows the saved entry.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_catalog_JS as catalogJs } from '../../../src/pages/home/render-workspace/client-script/home-views/catalog';
import { workspace_client_home_views_catalogCert_JS as certJs } from '../../../src/pages/home/render-workspace/client-script/home-views/catalog-cert';
import { workspace_client_home_views_catalogEdit_JS as editJs } from '../../../src/pages/home/render-workspace/client-script/home-views/catalog-edit';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

type Lens = { loadCatalog: () => void; catRoute: (id: string) => void };

let locale: 'en' | 'es' = 'en';
let fetchMock: ReturnType<typeof vi.fn>;
const t = (k: string) => HOME_COPY[locale][k] ?? k;
const esc = (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function loadLens(): Lens {
  const win = globalThis.window as unknown as Record<string, unknown>;
  const scope = new Proxy({} as Record<string | symbol, unknown>, {
    has: () => true,
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'window') return win;
      if (prop === 'document') return document;
      if (prop === 't') return t;
      if (prop === 'esc') return esc;
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop === 'needWs') return () => false;
      if (prop === 'i18nLoad') return () => '<div class="wsx-empty">…</div>';
      if (prop === 'i18nError') return (k: string) => `<div class="wsx-empty">${k}</div>`;
      if (prop === 'emptyState') return (a: string, b: string, c?: string) => `<div>${esc(a)} ${esc(b)}${c ?? ''}</div>`;
      if (prop === 'mdToHtml') return (s: string) => `<p>${esc(s)}</p>`;
      if (prop === 'okOr') {
        return async (r: Response) => {
          if (r.ok) return r;
          const b = (await r.json()) as { code?: string };
          throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, code: b.code });
        };
      }
      if (prop === 'errReason') return (_e: unknown, fallback: string) => fallback;
      if (prop === 'failToast') return () => {};
      if (prop === 'fmtDay') return (v: string) => String(v).slice(0, 10);
      if (prop === 'syncHash') return () => {};
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return undefined;
    },
    set: (target, prop, value) => {
      target[prop as string] = value;
      return true;
    },
  });
  const body = `with (scope) {\n${catalogJs}\n${certJs}\n${editJs}\nreturn { loadCatalog: loadCatalog, catRoute: catRoute };\n}`;
  return new Function('scope', body)(scope) as Lens;
}

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};


const TERM = {
  kind: 'term', id: 'term.ats', title: 'ATS', path: 'terms/ats.md', domain: 'Seguridad y salud', status: 'draft',
  tags: ['glosario'], terms: ['term.pcr'], upstream: [], downstream: [], aspects: [], aliases: ['charla de 5 minutos'],
  body: 'Charla previa.', extra: {},
  certification: { status: 'draft', declared_status: 'draft', content_hash: 'h1', stale: false, decision: null },
};

let patched: Record<string, unknown> | null = null;
function serve(onPatch: (body: Record<string, unknown>) => Response) {
  patched = null;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') { patched = JSON.parse(String(init.body)); return onPatch(patched!); }
    if (url.includes('/entries/')) return json({ enabled: true, entry: TERM, upstream: [], downstream: [], history: [] });
    return json({ enabled: true, entries: [TERM], facets: { kind: [{ value: 'term', count: 1 }], domain: [], status: [{ value: 'draft', count: 1 }] } });
  });
}

async function openEdit() {
  document.body.innerHTML = '<div id="wsxCatMount"></div>';
  const lens = loadLens();
  lens.catRoute('term.ats');
  lens.loadCatalog();
  await flush();
  (document.getElementById('catEditBtn') as HTMLButtonElement).click();
  return document.getElementById('catEditForm') as HTMLFormElement;
}
const field = (n: string) => document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${n}"]`)!;

beforeEach(() => {
  locale = 'en';
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_test';
  win.WSX_ADMIN = false;
});

describe('catalog entry edit form', () => {
  it('a member sees Edit on the entry and gets the form filled with its fields', async () => {
    serve(() => json({}, 500));
    const form = await openEdit();
    expect(form).toBeTruthy();
    expect(field('title').value).toBe('ATS');
    expect(field('domain').value).toBe('Seguridad y salud');
    expect(field('tags').value).toBe('glosario');
    expect(field('aliases').value).toBe('charla de 5 minutos');
    expect(field('terms').value).toBe('term.pcr');
    expect(field('body').value).toBe('Charla previa.');
  });

  it('saves only what changed and shows the saved entry', async () => {
    serve((body) => json({ ok: true, changed: Object.keys(body), entry: { ...TERM, ...body, title: body.title ?? TERM.title } }));
    const form = await openEdit();
    field('title').value = 'ATS — charla de 5 minutos';
    field('tags').value = 'glosario, seguridad, glosario';
    field('owner').value = 'SGI';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(patched).toEqual({ title: 'ATS — charla de 5 minutos', owner: 'SGI', tags: ['glosario', 'seguridad'] });
    expect(document.getElementById('catEditForm')).toBeNull();
    expect(document.querySelector('.wsx-cat__dhead h3')!.textContent).toBe('ATS — charla de 5 minutos');
    expect(document.querySelector('.wsx-cat__meta')!.textContent).toContain('SGI');
  });

  it('Cancel or an unchanged form goes back without calling the server', async () => {
    serve(() => json({}, 500));
    let form = await openEdit();
    (document.getElementById('catEditCancel') as HTMLButtonElement).click();
    expect(document.getElementById('catEditForm')).toBeNull();
    form = await openEdit();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(patched).toBeNull();
    expect(document.querySelector('.wsx-cat__dhead h3')!.textContent).toBe('ATS');
  });

  it('keeps the form and says why when the name is empty or the save fails (es)', async () => {
    locale = 'es';
    serve(() => json({ success: false, error: 'bad', code: 'INVALID_EDIT' }, 400));
    const form = await openEdit();
    expect(document.getElementById('catEditSave')!.textContent).toBe('Guardar');
    field('title').value = '  ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(patched).toBeNull();
    expect(document.getElementById('catEditErr')!.textContent).toBe(t('catalog.editNameRequired'));
    field('title').value = 'ATS';
    field('body').value = 'Otra cosa.';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(patched).toEqual({ body: 'Otra cosa.' });
    expect(document.getElementById('catEditErr')!.textContent).toBe(t('catalog.editFailed'));
    expect((document.getElementById('catEditSave') as HTMLButtonElement).disabled).toBe(false);
  });

  it('warns that saving a certified entry needs a new certification', async () => {
    const certifiedTerm = { ...TERM, status: 'certified', certification: { ...TERM.certification, status: 'certified' } };
    fetchMock = vi.fn(async (url: string) => url.includes('/entries/')
      ? json({ enabled: true, entry: certifiedTerm, upstream: [], downstream: [], history: [] })
      : json({ enabled: true, entries: [certifiedTerm], facets: { kind: [], domain: [], status: [] } }));
    await openEdit();
    expect(document.getElementById('catEditForm')!.textContent).toContain(t('catalog.editCertified'));
  });
});
