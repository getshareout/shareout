// @vitest-environment happy-dom
//
// Runtime tests for the Knowledge map fragment: the concentric layout (pure), the
// evidence panel (facts + quotes + source links, connections grouped by relation) and
// the finder (type chips, search debounce), in en and es — plus the team's curation
// (knowledge-curate.ts): solid vs dashed, admin controls vs read-only, the Rules view.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_knowledgeMap_JS as mapJs } from '../../../src/pages/home/render-workspace/client-script/home-views/knowledge-map';
import { workspace_client_home_views_knowledgeCurate_JS as curateJs } from '../../../src/pages/home/render-workspace/client-script/home-views/knowledge-curate';
import { KNOWLEDGE_MAP_COPY } from '../../../src/pages/home/home-i18n/copy/knowledge-map';

type LayoutNode = { id: string; x: number; y: number; r: number; ring: number };
type Lens = {
  kmState: { focus: string; depth: number; type: string; q: string; types: string[]; counts: Record<string, number>; top: unknown[]; hits: unknown[] | null; trail: string[]; dcache: Record<string, unknown>; gcache: Record<string, unknown> };
  kmLayout: (g: unknown, focus: string, type: string) => { nodes: LayoutNode[]; edges: unknown[]; hidden: number; ring1: number };
  kmPaintPanel: (d: unknown) => void;
  kmPaintFinder: () => void;
  kmRender: (m: HTMLElement, top: string) => void;
  kmTypeLabel: (t: string) => string;
  kmRelLabel: (t: string) => string;
  kcRenderRules: (m: HTMLElement, top: string) => void;
};

let locale: 'en' | 'es' = 'en';
let fetchMock: ReturnType<typeof vi.fn>;
let hash = '';
let opened: unknown[] = [];

function loadLens(): Lens {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_test';
  const scope = new Proxy({} as Record<string | symbol, unknown>, {
    has: () => true,
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'window') return win;
      if (prop === 'document') return document;
      if (prop === 't') return (k: string) => KNOWLEDGE_MAP_COPY[locale][k] ?? KNOWLEDGE_MAP_COPY.en[k] ?? k;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop === 'knBase') return () => '/v1/workspaces/wsp_test/knowledge';
      if (prop === 'knBindShell') return () => {};
      if (prop === 'syncHash') return () => { hash = String(target.knCurrentPath ?? ''); };
      if (prop === 'i18nLoad') return () => '<div class="wsx-empty">…</div>';
      if (prop === 'i18nEmpty') return (k: string) => '<div class="wsx-empty">' + (KNOWLEDGE_MAP_COPY[locale][k] ?? k) + '</div>';
      if (prop === 'i18nError') return (k: string) => '<div class="wsx-empty">' + k + '</div>';
      if (prop === 'fmtDay') return (v: string) => v;
      if (prop === 'openArtifact') return (...a: unknown[]) => { opened = a; };
      if (prop === 'wsxModal') return (title: string, body: string) => {
        const ov = document.createElement('div'); ov.className = 'wsx-modal'; ov.innerHTML = '<b>' + title + '</b><div class="wsx-modal__body">' + body + '</div>';
        document.body.appendChild(ov); return { ov, close: () => ov.remove(), body: ov.querySelector('.wsx-modal__body') };
      };
      if (prop === 'Promise') return Promise;
      if (prop === 'JSON') return JSON;
      if (prop === 'setTimeout') return globalThis.setTimeout;
      if (prop === 'clearTimeout') return globalThis.clearTimeout;
      if (prop === 'Math') return Math;
      if (prop === 'Number') return Number;
      if (prop === 'String') return String;
      if (prop === 'Object') return Object;
      if (prop === 'Error') return Error;
      if (prop === 'encodeURIComponent') return encodeURIComponent;
      return undefined;
    },
    set: (target, prop, value) => { target[prop as string] = value; return true; },
  });
  const names = ['kmState', 'kmLayout', 'kmPaintPanel', 'kmPaintFinder', 'kmRender', 'kmTypeLabel', 'kmRelLabel', 'kcRenderRules'];
  const body = 'with (scope) {\n' + mapJs + curateJs + '\nreturn { ' + names.map((n) => n + ': ' + n).join(', ') + ' };\n}';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('scope', body)(scope) as Lens;
}

const GRAPH = {
  nodes: [
    { id: 'org', type: 'Organization', name: 'Harbor Studio', mentions: 33 },
    { id: 'nw', type: 'Organization', name: 'Northwind', mentions: 31 },
    { id: 'lh', type: 'Product', name: 'Lighthouse', mentions: 11 },
    { id: 'mix', type: 'Product', name: 'Metricly', mentions: 9 },
    { id: 'proj', type: 'Project', name: 'Spring onboarding study', mentions: 14 },
    { id: 'far', type: 'Metric', name: 'DAU', mentions: 2 },
    { id: 'lonely', type: 'Metric', name: 'Orphan metric', mentions: 1 },
  ],
  edges: [
    { id: 'e1', from: 'nw', to: 'org', type: 'part_of', mentions: 7 },
    { id: 'e2', from: 'org', to: 'lh', type: 'runs', mentions: 3 },
    { id: 'e3', from: 'org', to: 'mix', type: 'uses', mentions: 2 },
    { id: 'e4', from: 'proj', to: 'org', type: 'part_of', mentions: 1 },
    { id: 'e5', from: 'lh', to: 'far', type: 'measures', mentions: 1 },
  ],
};

const DETAIL = {
  entity: { id: 'org', type: 'Organization', name: 'Harbor Studio', aliases: ['Harbor Studio', 'HS'], status: 'draft', mentions: 33, sources: [] },
  facts: [
    { id: 'f1', predicate: 'has_live_apps', value: '10', unit: 'count', validFrom: '2026-07-13', quote: '10 live apps', source: { kind: 'page', id: 'art_1', title: 'Harbor Studio — Home', url: 'https://shareout.site/a/overview/' } },
    { id: 'f2', predicate: 'founded', value: '2019', unit: null, validFrom: null, quote: 'founded in 2019', source: { kind: 'asset', id: 'dlv_1', title: 'Company deck.pdf', url: null } },
  ],
  relations: [
    { id: 'e1', type: 'part_of', direction: 'in', other: { id: 'nw', name: 'Northwind', type: 'Organization' }, mentions: 7, sources: [] },
    { id: 'e2', type: 'runs', direction: 'out', other: { id: 'lh', name: 'Lighthouse', type: 'Product' }, mentions: 3, sources: [] },
    { id: 'e4', type: 'part_of', direction: 'in', other: { id: 'proj', name: 'Spring onboarding study', type: 'Project' }, mentions: 1, sources: [] },
  ],
  mentions: Array.from({ length: 8 }, (_, i) => ({ quote: 'quote ' + i, locator: 'Section ' + i, source: { kind: 'page', id: 'art_' + i, title: 'Page ' + i, url: 'https://shareout.site/a/p' + i + '/' }, cite: 'Page ' + i })),
};

const dist = (a: LayoutNode, b: LayoutNode) => Math.hypot(a.x - b.x, a.y - b.y);

beforeEach(() => {
  (globalThis.window as unknown as Record<string, unknown>).WSX_ADMIN = false;
  locale = 'en';
  hash = '';
  opened = [];
  document.body.innerHTML = '';
  fetchMock = vi.fn(async () => ({ ok: false }));
});

describe('knowledge map — copy', () => {
  it('has the same keys in en and es, and the Map toggle label', () => {
    expect(Object.keys(KNOWLEDGE_MAP_COPY.es).sort()).toEqual(Object.keys(KNOWLEDGE_MAP_COPY.en).sort());
    expect(KNOWLEDGE_MAP_COPY.en['knowledge.viewMap']).toBe('Map');
    expect(KNOWLEDGE_MAP_COPY.es['knowledge.viewMap']).toBe('Mapa');
  });

  it('humanises unknown types and relations instead of showing raw keys', () => {
    const lens = loadLens();
    expect(lens.kmTypeLabel('Organization')).toBe('Organization');
    expect(lens.kmTypeLabel('Ad Type')).toBe('Ad Type');
    expect(lens.kmRelLabel('part_of')).toBe('part of');
    expect(lens.kmRelLabel('ships_with')).toBe('ships with');
    locale = 'es';
    expect(lens.kmTypeLabel('Organization')).toBe('Organización');
    expect(lens.kmRelLabel('part_of')).toBe('parte de');
  });
});

describe('knowledge map — layout', () => {
  it('puts the focus in the middle, neighbours on ring 1 and the rest on ring 2, nothing overlapping', () => {
    const lens = loadLens();
    const lay = lens.kmLayout(GRAPH, 'org', '');
    const by = Object.fromEntries(lay.nodes.map((n) => [n.id, n]));
    expect(by.org).toMatchObject({ x: 0, y: 0, ring: 0, r: 20 });
    expect(['nw', 'lh', 'mix', 'proj'].map((id) => by[id].ring)).toEqual([1, 1, 1, 1]);
    expect(by.far.ring).toBe(2);
    expect(by.lonely.ring).toBe(2);
    expect(lay.ring1).toBe(4);
    // ring-2 children sit next to their ring-1 parent, orphans elsewhere
    expect(dist(by.far, by.lh)).toBeLessThan(dist(by.far, by.nw));
    for (const a of lay.nodes) for (const b of lay.nodes) if (a.id < b.id) expect(dist(a, b)).toBeGreaterThan(a.r + b.r + 10);
    // bigger mention count → bigger node, capped
    expect(by.nw.r).toBeGreaterThan(by.far.r);
    expect(by.nw.r).toBeLessThanOrEqual(15);
    expect(lay.edges).toHaveLength(5);
  });

  it('a type filter hides other types but never the focus, and reports how many it hid', () => {
    const lens = loadLens();
    const lay = lens.kmLayout(GRAPH, 'org', 'Product');
    expect(lay.nodes.map((n) => n.id).sort()).toEqual(['lh', 'mix', 'org']);
    expect(lay.hidden).toBe(4);
    expect(lay.edges.map((e: { id: string }) => e.id).sort()).toEqual(['e2', 'e3']);
  });

  it('ring 1 is grouped by type so clusters read', () => {
    const lens = loadLens();
    const lay = lens.kmLayout(GRAPH, 'org', '');
    const ring1 = lay.nodes.filter((n) => n.ring === 1).sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
    const types = ring1.map((n) => (GRAPH.nodes.find((g) => g.id === n.id) as { type: string }).type);
    // Organization, Product, Product, Project in some rotation — never Product split by another type
    const joined = types.concat(types).join(',');
    expect(joined).toContain('Product,Product');
  });

  it('survives an empty graph and a focus that is not in it', () => {
    const lens = loadLens();
    expect(lens.kmLayout({ nodes: [], edges: [] }, 'x', '')).toMatchObject({ nodes: [], edges: [], hidden: 0, ring1: 0 });
    const lay = lens.kmLayout({ nodes: GRAPH.nodes.slice(1, 3), edges: [] }, 'nope', '');
    expect(lay.nodes).toHaveLength(2);
    expect(lay.nodes.every((n) => n.ring === 2)).toBe(true);
  });
});

describe('knowledge map — evidence panel', () => {
  it('renders facts with quote + source, connections grouped by relation, mentions folded past six', () => {
    const lens = loadLens();
    lens.kmState.types = ['Metric', 'Organization', 'Product', 'Project'];
    document.body.innerHTML = '<aside id="kmPanel"></aside>';
    lens.kmPaintPanel(DETAIL);
    const panel = document.getElementById('kmPanel')!;
    expect(panel.querySelector('.km__pname')!.textContent).toBe('Harbor Studio');
    expect(panel.querySelector('.km__aka')!.textContent).toBe('Also: HS');
    expect(panel.querySelector('.km__pm')!.textContent).toBe('33 mentions');
    // facts
    const facts = panel.querySelectorAll('.km__fact');
    expect(facts).toHaveLength(2);
    expect(facts[0].querySelector('.km__fk')!.textContent).toBe('has live apps');
    expect(facts[0].querySelector('.km__fv')!.textContent).toContain('10');
    expect(facts[0].querySelector('.km__since')!.textContent).toBe('since 2026-07-13');
    expect(facts[0].querySelector('.km__q')!.textContent).toBe('“10 live apps”');
    const src = facts[0].querySelector<HTMLButtonElement>('[data-km-open-id]')!;
    expect(src.getAttribute('data-km-open-slug')).toBe('overview');
    expect(src.textContent).toContain('Harbor Studio — Home');
    // a File source has no page to open: label + badge, no button
    expect(facts[1].querySelector('[data-km-open-id]')).toBeNull();
    expect(facts[1].querySelector('.km__src--file')!.textContent).toContain('Company deck.pdf');
    expect(facts[1].querySelector('.km__src--file')!.textContent).toContain('File');
    // connections grouped by direction + relation, in document order
    const groups = Array.from(panel.querySelectorAll('.km__gh')).map((g) => g.textContent!.replace(/\s+/g, ' ').trim());
    expect(groups).toEqual(['←part of2', '→runs1']);
    expect(panel.querySelectorAll('.km__group .km__item')).toHaveLength(3);
    // mentions: 6 visible, 2 folded behind "Show 2 more"
    expect(panel.querySelectorAll('.km__mention')).toHaveLength(8);
    expect(panel.querySelector('#kmMore')!.querySelectorAll('.km__mention')).toHaveLength(2);
    expect(panel.querySelector('#kmMoreBtn')!.textContent).toBe('Show 2 more');
    (panel.querySelector('#kmMoreBtn') as HTMLButtonElement).click();
    expect(panel.querySelector('#kmMore')!.classList.contains('is-open')).toBe(true);
    expect(panel.querySelector('#kmMoreBtn')).toBeNull();
  });

  it('speaks Spanish when the shell does', () => {
    locale = 'es';
    const lens = loadLens();
    lens.kmState.types = ['Organization', 'Product', 'Project'];
    document.body.innerHTML = '<aside id="kmPanel"></aside>';
    lens.kmPaintPanel(DETAIL);
    const text = document.getElementById('kmPanel')!.textContent!;
    expect(text).toContain('Organización');
    expect(text).toContain('33 menciones');
    expect(text).toContain('Datos');
    expect(text).toContain('Conexiones');
    expect(text).toContain('Mencionado en');
    expect(text).toContain('parte de');
    expect(text).toContain('Ver 2 más');
    expect(text).toContain('desde 2026-07-13');
  });

  it('shows quotes as words, without the markdown bold markers of their source', () => {
    const lens = loadLens();
    document.body.innerHTML = '<aside id="kmPanel"></aside>';
    const quote = '**LTI (Lost Time Injury)** — __lesión__ con días perdidos';
    lens.kmPaintPanel({ ...DETAIL, facts: [{ ...DETAIL.facts[0], quote }], mentions: [{ ...DETAIL.mentions[0], quote }] });
    const qs = Array.from(document.querySelectorAll('.km__q')).map((q) => q.textContent);
    expect(qs).toEqual(['“LTI (Lost Time Injury) — lesión con días perdidos”', '“LTI (Lost Time Injury) — lesión con días perdidos”']);
  });

  it('opens a page source in a Studio tab', () => {
    const lens = loadLens();
    lens.kmState.types = ['Organization'];
    document.body.innerHTML = '<aside id="kmPanel"></aside>';
    lens.kmPaintPanel(DETAIL);
    (document.querySelector('[data-km-open-id="art_1"]') as HTMLButtonElement).click();
    expect(opened).toEqual(['overview', 'Harbor Studio — Home', 'art_1']);
  });
});

describe('knowledge map — finder and shell', () => {
  it('boots focused on the most-mentioned entity, draws it and syncs the hash', async () => {
    const lens = loadLens();
    fetchMock.mockImplementation(async (url: string) => {
      if (/\/entities\?limit=40$/.test(url)) return { ok: true, json: async () => ({ types: [{ type: 'Organization', count: 2 }, { type: 'Product', count: 2 }, { type: 'Project', count: 1 }, { type: 'Metric', count: 2 }], entities: GRAPH.nodes.slice(0, 5) }) };
      if (/\/graph\?limit=80$/.test(url)) return { ok: true, json: async () => GRAPH };
      if (/\/graph\?focus=org&depth=1/.test(url)) return { ok: true, json: async () => GRAPH };
      if (/\/entities\/org$/.test(url)) return { ok: true, json: async () => DETAIL };
      return { ok: false };
    });
    document.body.innerHTML = '<div id="wsxKnMount"></div>';
    lens.kmRender(document.getElementById('wsxKnMount')!, '<div id="top"></div>');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock.mock.calls.some((c) => /\/graph\?limit=80$/.test(String(c[0])))).toBe(false);
    expect(lens.kmState.focus).toBe('org');
    expect(hash).toBe('map/org');
    // chips are alphabetical with counts; the list marks the focus
    const chips = Array.from(document.querySelectorAll('.km__chip')).map((c) => c.textContent);
    expect(chips).toEqual(['All', 'Metric2', 'Organization2', 'Product2', 'Project1']);
    expect(document.querySelector('.km__item.is-on .km__iname')!.textContent).toBe('Harbor Studio');
    // canvas: 7 nodes, 5 edges, labels on for a small ring, focus drawn with a halo
    const svg = document.getElementById('kmSvg')!;
    expect(svg.querySelectorAll('[data-km-node]')).toHaveLength(7);
    expect(svg.querySelectorAll('.km__e')).toHaveLength(5);
    expect(svg.classList.contains('km--labels')).toBe(true);
    expect(svg.querySelector('.km__node.is-focus .km__halo')).not.toBeNull();
    expect(svg.querySelector('.km__node.is-focus .km__lbl')!.textContent).toBe('Harbor Studio');
    expect(svg.querySelector('.km__e.is-primary .km__elbl')!.textContent).toBe('part of');
    expect(document.querySelector('.km__crumb.is-cur')!.textContent).toBe('Harbor Studio');
    expect(document.getElementById('kmPanel')!.querySelector('.km__pname')!.textContent).toBe('Harbor Studio');
  });

  it('type chips filter the list and the canvas; search is debounced and server-side', async () => {
    vi.useFakeTimers();
    const lens = loadLens();
    fetchMock.mockImplementation(async (url: string) => {
      if (/\/entities\?limit=40$/.test(url)) return { ok: true, json: async () => ({ types: [{ type: 'Organization', count: 2 }, { type: 'Product', count: 2 }], entities: GRAPH.nodes.slice(0, 4) }) };
      if (/\/graph\?/.test(url)) return { ok: true, json: async () => GRAPH };
      if (/\/entities\/org$/.test(url)) return { ok: true, json: async () => DETAIL };
      if (/\/entities\?limit=30&q=gen$/.test(url)) return { ok: true, json: async () => ({ types: [], entities: [GRAPH.nodes[2]] }) };
      return { ok: false };
    });
    document.body.innerHTML = '<div id="wsxKnMount"></div>';
    lens.kmRender(document.getElementById('wsxKnMount')!, '');
    await vi.runAllTimersAsync();
    (document.querySelector('[data-km-go="org"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    (document.querySelector('[data-km-type="Product"]') as HTMLButtonElement).click();
    expect(Array.from(document.querySelectorAll('#kmList .km__item .km__iname')).map((n) => n.textContent)).toEqual(['Lighthouse', 'Metricly']);
    expect(document.getElementById('kmSvg')!.querySelectorAll('[data-km-node]')).toHaveLength(3);
    expect(document.querySelector('.km__note')!.textContent).toBe('4 hidden by the type filter');
    const search = document.getElementById('kmSearch') as HTMLInputElement;
    const calls = fetchMock.mock.calls.length;
    search.value = 'ge'; search.dispatchEvent(new Event('input'));
    search.value = 'gen'; search.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock.mock.calls.length).toBe(calls); // still debouncing
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
    expect(String(fetchMock.mock.calls[calls][0])).toContain('/entities?limit=30&q=gen');
    expect(document.querySelector('.km__lh')!.textContent).toBe('Results');
    expect(Array.from(document.querySelectorAll('#kmList .km__item .km__iname')).map((n) => n.textContent)).toEqual(['Lighthouse']);
    // Enter picks the first hit and resets the trail
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(lens.kmState.focus).toBe('lh');
    expect(lens.kmState.trail).toEqual(['lh']);
    vi.useRealTimers();
  });
});

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (d: unknown) => ({ ok: true, json: async () => d });

describe('knowledge map — the team’s curation', () => {
  const CONF_GRAPH = {
    nodes: GRAPH.nodes.map((n, i) => ({ ...n, status: i < 3 ? 'confirmed' : 'draft' })),
    edges: GRAPH.edges.map((e, i) => ({ ...e, status: i === 0 ? 'confirmed' : 'draft' })),
  };

  it('draws what the team confirmed solid and what Knowledge proposed dashed, with a legend', async () => {
    const lens = loadLens();
    fetchMock.mockImplementation(async (url: string) => {
      if (/\/entities\?limit=40/.test(url)) return json({ types: [{ type: 'Organization', count: 2 }], entities: CONF_GRAPH.nodes.slice(0, 5) });
      if (/\/graph\?/.test(url)) return json(CONF_GRAPH);
      if (/\/entities\/org$/.test(url)) return json({ ...DETAIL, entity: { ...DETAIL.entity, status: 'confirmed' } });
      return { ok: false };
    });
    document.body.innerHTML = '<div id="wsxKnMount"></div>';
    lens.kmRender(document.getElementById('wsxKnMount')!, '');
    await flush();
    const svg = document.getElementById('kmSvg')!;
    expect(svg.querySelectorAll('.km__node.is-draft')).toHaveLength(4);
    expect(svg.querySelectorAll('.km__e.is-draft')).toHaveLength(4);
    expect(document.querySelector('.km__legend')!.textContent).toContain('Confirmed by the team');
    expect(document.querySelector('.km__legend')!.textContent).toContain('Proposed by Knowledge');
    // members get no edit affordances on the canvas
    expect(svg.querySelector('[data-km-handle]')).toBeNull();
    expect(document.querySelector('[data-km-new]')).toBeNull();
    expect(document.getElementById('kmPanel')!.textContent).toContain('Confirmed by the team');
    // the finder filters by status, server-side
    (document.querySelector('[data-km-status="draft"]') as HTMLButtonElement).click();
    expect(fetchMock.mock.calls.some((c) => /\/entities\?limit=40&status=draft$/.test(String(c[0])))).toBe(true);
  });

  it('gives admins the controls: confirm, retype, rename, connect, facts, merge, discard', async () => {
    (globalThis.window as unknown as Record<string, unknown>).WSX_ADMIN = true;
    const lens = loadLens();
    lens.kmState.types = ['Organization', 'Product', 'Project'];
    lens.kmState.focus = 'org';
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return json({ ok: true, id: 'org' });
      if (/\/history/.test(url)) return json({ history: [{ id: 1, at: '2026-11-18T10:00:00Z', by: 'u1', action: 'entity.update', targets: ['org'], detail: { name: { from: 'HS Ltd', to: 'Harbor Studio' } } }] });
      if (/\/entities\?limit=40/.test(url)) return json({ types: [], entities: [] });
      return json({});
    });
    document.body.innerHTML = '<aside id="kmPanel"></aside>';
    lens.kmPaintPanel(DETAIL);
    const panel = document.getElementById('kmPanel')!;
    expect(panel.querySelector('.kc-prop')!.textContent).toContain('Proposed by Knowledge');
    for (const sel of ['[data-kc-confirm]', '[data-kc-discard]', '[data-kc-type]', '[data-kc-name]', '[data-kc-alias]', '[data-kc-def]', '[data-kc-fact]', '[data-kc-conn]', '[data-kc-merge]']) {
      expect(panel.querySelector(sel), sel).not.toBeNull();
    }
    expect(panel.querySelectorAll('[data-kc-rok]')).toHaveLength(3); // every learned connection can be confirmed
    expect(panel.querySelectorAll('[data-kc-fok]')).toHaveLength(2);
    await flush();
    expect(document.getElementById('kcHist')!.textContent).toContain('Edited «HS Ltd» → «Harbor Studio»');

    (panel.querySelector('[data-kc-confirm]') as HTMLButtonElement).click();
    await flush();
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')!;
    expect(String(patch[0])).toBe('/v1/workspaces/wsp_test/knowledge/entities/org');
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toEqual({ confirm: true });
  });

  it('shows a learned value next to the team’s instead of replacing it', () => {
    (globalThis.window as unknown as Record<string, unknown>).WSX_ADMIN = true;
    const lens = loadLens();
    document.body.innerHTML = '<aside id="kmPanel"></aside>';
    lens.kmPaintPanel({
      ...DETAIL,
      entity: { ...DETAIL.entity, status: 'confirmed' },
      facts: [
        { id: 'ft', predicate: 'founded', value: '2018', unit: null, validFrom: null, quote: '', source: null, status: 'confirmed' },
        { ...DETAIL.facts[1], status: 'draft' },
      ],
    });
    const facts = document.querySelectorAll('.km__fact');
    expect(facts[0].classList.contains('is-team')).toBe(true);
    expect(facts[1].classList.contains('is-clash')).toBe(true);
    expect(facts[1].querySelector('.kc-clash')!.textContent).toBe('The team says 2018. Keep the team’s value or use this one.');
    expect(facts[1].querySelector('[data-kc-fok]')!.getAttribute('title')).toBe('Use this one');
  });

  it('members see the panel read-only', () => {
    const lens = loadLens();
    document.body.innerHTML = '<aside id="kmPanel"></aside>';
    lens.kmPaintPanel(DETAIL);
    const panel = document.getElementById('kmPanel')!;
    expect(panel.querySelector('.kc-prop')!.textContent).toBe('Proposed by Knowledge · found in 0 sources');
    expect(panel.querySelector('[data-kc-confirm], [data-kc-type], [data-kc-name], .km__acts, [data-kc-merge], #kcHist')).toBeNull();
  });

  it('renders the Rules view: types with switches, glossary, rules, discarded — editable for admins only', async () => {
    const schema = { types: [{ type: 'Registro', description: 'RS-xx', ignored: false, team: true, count: 3 }, { type: 'Lugar', description: '', ignored: true, team: true, count: 2 }, { type: 'Organization', description: '', ignored: false, team: false, count: 5 }], teamOnly: false, relationTypes: ['part_of'] };
    const rules = { rules: [{ id: 'r1', kind: 'glossary', term: 'NC (en RS-28)', text: 'No corresponde', at: '' }, { id: 'r2', kind: 'rule', term: null, text: 'Codes first', at: '' }] };
    const discarded = { discarded: [{ kind: 'entity', key: 'neuquen', label: 'Neuquén', reason: 'noint', at: '' }] };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method) return json({ ok: true });
      if (/\/schema$/.test(url)) return json(schema);
      if (/\/rules$/.test(url)) return json(rules);
      if (/\/discarded/.test(url)) return json(discarded);
      return { ok: false };
    });
    locale = 'es';
    let lens = loadLens();
    document.body.innerHTML = '<div id="m"></div>';
    lens.kcRenderRules(document.getElementById('m')!, '');
    await flush();
    let text = document.getElementById('kcRules')!.textContent!;
    expect(text).toContain('Estructura');
    expect(text).toContain('NC (en RS-28)');
    expect(text).toContain('Codes first');
    expect(text).toContain('Solo dueños y administradores');
    expect(document.querySelectorAll('.kc-switch:disabled').length).toBe(4); // team-only + 3 types
    expect(text).not.toContain('Descartados'); // members don't see the discarded list
    expect(fetchMock.mock.calls.some((c) => /\/discarded/.test(String(c[0])))).toBe(false);

    (globalThis.window as unknown as Record<string, unknown>).WSX_ADMIN = true;
    lens = loadLens();
    document.body.innerHTML = '<div id="m"></div>';
    lens.kcRenderRules(document.getElementById('m')!, '');
    await flush();
    text = document.getElementById('kcRules')!.textContent!;
    expect(text).toContain('Descartados');
    expect(text).toContain('Neuquén · No nos interesa');
    expect(document.querySelector('.kc-trow.is-off')!.textContent).toContain('Lugar');
    // switching a type off ignores it
    (document.querySelector('[data-kc-tog="Registro"]') as HTMLButtonElement).click();
    await flush();
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')!;
    expect(String(put[0])).toBe('/v1/workspaces/wsp_test/knowledge/schema/types/Registro');
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ ignored: true });
  });
});
