// @vitest-environment happy-dom
//
// Catalog lens certification panel: admins certify / revoke / deprecate the version they
// are looking at (with a note); members see who certified it and when, and no controls.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_catalog_JS as catalogJs } from '../../../src/pages/home/render-workspace/client-script/home-views/catalog';
import { workspace_client_home_views_catalogCert_JS as certJs } from '../../../src/pages/home/render-workspace/client-script/home-views/catalog-cert';
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
  const body = `with (scope) {\n${catalogJs}\n${certJs}\nreturn { loadCatalog: loadCatalog, catRoute: catRoute };\n}`;
  return new Function('scope', body)(scope) as Lens;
}

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const ANA = { id: 'usr_ana', name: 'Ana Gómez', email: 'ana@agencia.example' };
const certified = (hash: string) => ({ id: 'ccert_1', entry_id: 't.orders', content_hash: hash, decision: 'certified', note: 'Matches the ads platform', decided_by: ANA, decided_at: '2026-10-25T12:00:00.000Z' });

function entry(certification: Record<string, unknown>) {
  return {
    kind: 'table', id: 't.orders', title: 'Orders', path: 'tables/orders.md', status: certification.status,
    tags: [], terms: [], upstream: [], downstream: [], aspects: [], aliases: [], body: 'One row per order.', extra: {},
    certification: { declared_status: null, content_hash: 'h1', stale: false, decision: null, ...certification },
  };
}

function serve(e: ReturnType<typeof entry>, history: unknown[], onCertify?: (body: Record<string, unknown>) => Response) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/certify')) return onCertify ? onCertify(JSON.parse(String(init?.body))) : json({}, 500);
    if (url.includes('/entries/')) return json({ enabled: true, entry: e, upstream: [], downstream: [], history });
    return json({ enabled: true, entries: [e], facets: { kind: [{ value: 'table', count: 1 }], domain: [], status: [{ value: e.status, count: 1 }] } });
  });
}

async function open(): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="wsxCatMount"></div>';
  const lens = loadLens();
  lens.catRoute('t.orders');
  lens.loadCatalog();
  await flush();
  return document.getElementById('catCert') as HTMLElement;
}

beforeEach(() => {
  locale = 'en';
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_test';
  win.WSX_ADMIN = false;
});

describe('catalog certification panel — admin', () => {
  it('certifies the version on screen, with a note, and shows who and when', async () => {
    (globalThis.window as unknown as Record<string, unknown>).WSX_ADMIN = true;
    let sent: Record<string, unknown> = {};
    serve(entry({ status: 'draft' }), [], (body) => {
      sent = body;
      return json({ ok: true, status: 'certified', certification: { status: 'certified', declared_status: null, content_hash: 'h1', stale: false, decision: certified('h1') }, history: [{ ...certified('h1'), current: true }] });
    });
    const panel = await open();
    expect(panel.textContent).toContain(t('catalog.certNone'));
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[data-cat-decide]')].map((b) => b.getAttribute('data-cat-decide'));
    expect(buttons).toEqual(['certified', 'deprecated']);

    (document.getElementById('catCertNote') as HTMLTextAreaElement).value = 'Matches the ads platform';
    panel.querySelector<HTMLButtonElement>('[data-cat-decide="certified"]')!.click();
    await flush();

    expect(sent).toEqual({ decision: 'certified', note: 'Matches the ads platform', content_hash: 'h1' });
    const fresh = document.getElementById('catCert')!;
    expect(fresh.textContent).toContain('Certified by Ana Gómez on 2026-10-25.');
    expect(fresh.textContent).toContain('Matches the ads platform');
    expect([...fresh.querySelectorAll('[data-cat-decide]')].map((b) => b.getAttribute('data-cat-decide'))).toEqual(['revoked', 'deprecated']);
    expect(fresh.querySelectorAll('.wsx-cat__hrow')).toHaveLength(1);
    expect(document.getElementById('catDetailBadge')!.textContent).toContain(t('catalog.statusCertified'));
  });

  it('says so when the entry changed during review, and lets the admin try again', async () => {
    (globalThis.window as unknown as Record<string, unknown>).WSX_ADMIN = true;
    serve(entry({ status: 'draft' }), [], () => json({ success: false, error: 'changed', code: 'CONFLICT' }, 409));
    const panel = await open();
    const btn = panel.querySelector<HTMLButtonElement>('[data-cat-decide="certified"]')!;
    btn.click();
    await flush();
    expect(document.getElementById('catCertErr')!.textContent).toBe(t('catalog.certChanged'));
    expect(btn.disabled).toBe(false);
  });

  it('shows "changed since certification" and marks the history row as an earlier version (es)', async () => {
    locale = 'es';
    (globalThis.window as unknown as Record<string, unknown>).WSX_ADMIN = true;
    serve(entry({ status: 'draft', stale: true, content_hash: 'h2', decision: certified('h1') }), [{ ...certified('h1'), current: false }]);
    const panel = await open();
    expect(panel.textContent).toContain('Cambió desde la certificación.');
    expect(panel.textContent).toContain('Ana Gómez certificó una versión anterior el 2026-10-25.');
    expect(panel.textContent).toContain('versión anterior');
    expect(panel.querySelector('[data-cat-decide="certified"]')!.textContent).toBe('Certificar entrada');
    expect(document.getElementById('catDetailBadge')!.textContent).toContain('cambió');
  });
});

describe('catalog certification panel — member', () => {
  it('shows who certified it and when, with no controls', async () => {
    serve(entry({ status: 'certified', decision: certified('h1') }), [{ ...certified('h1'), current: true }]);
    const panel = await open();
    expect(panel.textContent).toContain('Certified by Ana Gómez on 2026-10-25.');
    expect(panel.querySelector('[data-cat-decide]')).toBeNull();
    expect(panel.querySelector('textarea')).toBeNull();
    expect(panel.querySelectorAll('.wsx-cat__hrow')).toHaveLength(1);
  });

  it('tells a member that only owners and admins certify', async () => {
    locale = 'es';
    serve(entry({ status: 'draft' }), []);
    const panel = await open();
    expect(panel.textContent).toContain('Solo propietarios y administradores pueden certificar.');
    expect(panel.querySelector('[data-cat-decide]')).toBeNull();
  });
});
