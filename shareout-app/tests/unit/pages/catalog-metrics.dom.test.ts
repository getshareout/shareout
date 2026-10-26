// @vitest-environment happy-dom
//
// Catalog lens, metrics: the metric segment lists Estado / Dueño / Fuente / Frescura,
// and a metric's entry shows its formula and a Try it panel whose numbers come out in
// the shell's language (es-AR: 2,50x, $ 1.520,50).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_catalog_JS as catalogJs } from '../../../src/pages/home/render-workspace/client-script/home-views/catalog';
import { workspace_client_home_views_catalogCert_JS as certJs } from '../../../src/pages/home/render-workspace/client-script/home-views/catalog-cert';
import { workspace_client_home_views_catalogMetrics_JS as metricsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/catalog-metrics';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

type Lens = { loadCatalog: () => void; catRoute: (id: string) => void };

let locale: 'en' | 'es' = 'en';
let fetchMock: ReturnType<typeof vi.fn>;
const t = (k: string) => HOME_COPY[locale][k] ?? k;
const esc = (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function loadLens(): Lens {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.__SO_HOME_LOCALE = () => locale;
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
      if (prop === 'locTag') return () => (locale === 'es' ? 'es-AR' : 'en-US');
      if (prop === 'needWs') return () => false;
      if (prop === 'i18nLoad') return () => '<div class="wsx-empty">…</div>';
      if (prop === 'i18nError') return (k: string) => `<div class="wsx-empty">${k}</div>`;
      if (prop === 'emptyState') return (a: string) => `<div>${esc(a)}</div>`;
      if (prop === 'mdToHtml') return (s: string) => `<p>${esc(s)}</p>`;
      if (prop === 'okOr') return async (r: Response) => (r.ok ? r : Promise.reject(Object.assign(new Error('x'), { status: r.status })));
      if (prop === 'errReason') return (_e: unknown, fallback: string) => fallback;
      if (prop === 'fmtDay') return (v: string) => String(v).slice(0, 10);
      if (prop === 'adRelDate') return () => '3h ago';
      if (prop === 'syncHash') return () => {};
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return undefined;
    },
    set: (target, prop, value) => {
      target[prop as string] = value;
      return true;
    },
  });
  const body = `with (scope) {\n${catalogJs}\n${certJs}\n${metricsJs}\nreturn { loadCatalog: loadCatalog, catRoute: catRoute };\n}`;
  return new Function('scope', body)(scope) as Lens;
}

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

const ENTRY = {
  kind: 'metric', id: 'metric.roas', title: 'ROAS', path: 'metrics/roas.md', status: 'certified', owner: 'ana@agencia.example',
  tags: [], terms: [], upstream: [], downstream: [], aspects: [], aliases: [], body: '', extra: {},
  certification: { status: 'certified', declared_status: null, content_hash: 'h1', stale: false, decision: null },
};

const LISTED = {
  id: 'metric.roas', title: 'ROAS', title_es: 'Retorno publicitario', owner: 'ana@agencia.example', domain: null, status: 'certified', stale: false,
  source: { type: 'shared_table', shared_table: 'ads_daily', dialect: 'sqlite' }, freshness_sla: '26h', problem: null, can_run: true,
};

const DETAIL = {
  ...LISTED, type: 'ratio', formula: 'Σ Ingresos ÷ Σ Inversión', numerator: { agg: 'sum', expr: 'Ingresos' }, denominator: { agg: 'sum', expr: 'Inversión' },
  grains: ['month', 'week'], dimensions: ['canal', 'cliente'], freshness: { sla: '26h', last_updated_at: '2026-10-25T09:00:00.000Z', stale: false },
};

const RESULT = {
  status: 'certified', certified_by: { id: 'u', name: 'Ana Gómez', email: null }, certified_at: '2026-10-20T12:00:00.000Z',
  query: { grain: 'month', by: ['canal'], from: '2026-03-01', to: '2026-04-30', where: {} },
  rows: [{ period: '2026-03-01', canal: 'Meta', value: 2.5 }, { period: '2026-04-01', canal: 'Meta', value: 1520.5 }],
  format: { kind: 'ratio', decimals: 2, suffix: 'x' }, truncated: false,
};

let posted: Record<string, unknown> | null = null;
function serve(detail: Record<string, unknown> = DETAIL, result: Record<string, unknown> = RESULT) {
  posted = null;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/query')) { posted = JSON.parse(String(init?.body)); return json(result); }
    if (url.includes('/catalog/metrics/')) return json({ enabled: true, metric: detail });
    if (url.endsWith('/catalog/metrics')) return json({ enabled: true, metrics: [LISTED] });
    if (url.includes('/entries/')) return json({ enabled: true, entry: ENTRY, history: [] });
    return json({ enabled: true, entries: [ENTRY], facets: { kind: [{ value: 'metric', count: 1 }], domain: [], status: [{ value: 'certified', count: 1 }] } });
  });
}

beforeEach(() => {
  locale = 'en';
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_test';
  win.WSX_ADMIN = false;
  document.body.innerHTML = '<div id="wsxCatMount"></div>';
});

describe('the metric segment', () => {
  it('lists metrics with status, owner, source and freshness (es)', async () => {
    locale = 'es';
    serve();
    loadLens().loadCatalog();
    await flush();
    (document.querySelector('[data-cat-kind-seg="metric"]') as HTMLButtonElement).click();
    await flush();
    const heads = [...document.querySelectorAll('.wsx-cat__table th')].map((th) => th.textContent);
    expect(heads).toEqual(['Nombre', 'Estado', 'Dueño', 'Fuente', 'Frescura']);
    const row = document.querySelector('#catList tr[data-cat-id="metric.roas"]') as HTMLElement;
    expect(row.textContent).toContain('Retorno publicitario');
    expect(row.textContent).toContain('tabla compartida ads_daily');
    expect(row.textContent).toContain('≤ 26 h');
    expect(row.textContent).toContain(HOME_COPY.es['catalog.statusCertified']);
  });
});

describe("a metric's entry", () => {
  it('shows the formula and runs Try it, formatting numbers for es-AR', async () => {
    locale = 'es';
    serve();
    const lens = loadLens();
    lens.catRoute('metric.roas');
    lens.loadCatalog();
    await flush();
    const panel = document.getElementById('catMetric') as HTMLElement;
    expect(panel.textContent).toContain('Σ Ingresos ÷ Σ Inversión');
    expect(panel.textContent).toContain('Mes, Semana');
    expect(panel.textContent).toContain('≤ 26 h · actualizada 3h ago');

    (panel.querySelector('[data-cat-by][value="canal"]') as HTMLInputElement).checked = true;
    (document.getElementById('catTryRun') as HTMLButtonElement).click();
    await flush();
    expect(posted).toEqual({ grain: 'month', by: ['canal'] });
    const out = document.getElementById('catTryOut') as HTMLElement;
    const cells = [...out.querySelectorAll('tbody td')].map((td) => td.textContent);
    expect(cells).toEqual(['2026-03-01', 'Meta', '2,50x', '2026-04-01', 'Meta', '1.520,50x']);
    expect(out.textContent).toContain('Ana Gómez certificó esta entrada el 2026-10-20.');
    expect((document.getElementById('catTryFrom') as HTMLInputElement).value).toBe('2026-03-01');
  });

  it('formats currency and flags an uncertified number (en)', async () => {
    serve(DETAIL, { ...RESULT, status: 'draft', certified_by: null, format: { kind: 'currency', currency: 'ARS' }, rows: [{ period: '2026-03-01', value: 1520.5 }], query: { grain: 'month', by: [] } });
    const lens = loadLens();
    lens.catRoute('metric.roas');
    lens.loadCatalog();
    await flush();
    (document.getElementById('catTryRun') as HTMLButtonElement).click();
    await flush();
    const out = document.getElementById('catTryOut') as HTMLElement;
    expect(out.querySelector('tbody td.wsx-atbl__num')?.textContent).toMatch(/ARS\s?1,520\.50/);
    expect(out.textContent).toContain(HOME_COPY.en['catalog.mDraftNote']);
  });

  it('explains why it cannot run, with no Run button', async () => {
    serve({ ...DETAIL, can_run: false });
    let lens = loadLens();
    lens.catRoute('metric.roas');
    lens.loadCatalog();
    await flush();
    expect(document.getElementById('catTryRun')).toBeNull();
    expect(document.getElementById('catMetric')?.textContent).toContain(HOME_COPY.en['catalog.mCantRun']);

    document.body.innerHTML = '<div id="wsxCatMount"></div>';
    serve({ ...DETAIL, can_run: false, problem: { message: 'No shared table "ads_daily" in this workspace' } });
    lens = loadLens();
    lens.catRoute('metric.roas');
    lens.loadCatalog();
    await flush();
    expect(document.getElementById('catMetric')?.textContent).toContain('This metric can’t run: No shared table "ads_daily" in this workspace');
  });
});
