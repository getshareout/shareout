// @vitest-environment happy-dom
//
// Studio inspector Data tab: the same /sources list and words as the shared-link viewer,
// editor details with links to the lenses that manage a source, and outlines inside the
// stage through the stage wrapper's frame bridge.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_CLIENT } from '../../../src/pages/home/render-workspace/client-script/index';
import { LAZY_CHUNKS, lazyChunkBody } from '../../../src/pages/home/render-workspace/client-script/lazy-chunks';
import { workspace_client_inspector_data_JS as DATA } from '../../../src/pages/home/render-workspace/client-script/inspector-data';
import type { DataSource, SourcesResponse } from '../../../shared/data-sources/types';

type Art = { id?: string; slug?: string; type?: string };

const src = (over: Partial<DataSource>): DataSource => ({
  key: 'json:snapshot', kind: 'json', label: 'Resumen de pauta', provider: 'shareout', provider_label: null,
  declared: true, direct: true, freshness: {}, feeds: [{ selector: '#kpi' }], feed_count: 2, upstream: [], access: 'full', ...over,
});
const RESPONSE: SourcesResponse = {
  artifact_id: 'art_1', version: { id: 'ver_1', number: 7, page: 'index.html' }, access: 'full', scoped: false,
  sources: [
    src({
      freshness: { last_refresh_at: new Date(Date.now() - 2 * 3_600_000 - 30_000).toISOString(), refresher: { type: 'job', name: 'Ads diario' } },
      details: { query: 'SELECT spend FROM ads', manage: { jobs: '/home?workspace=wsp_1&view=schedules', connections: '/home?workspace=wsp_1&view=connectors' } },
    }),
    src({ key: 'table:leads', kind: 'table', label: 'leads', declared: false, feeds: [{ selector: '#leads' }], feed_count: 1 }),
    src({ key: 'connection:~1', kind: 'connection', label: 'connection', provider: 'google-ads', provider_label: 'Google Ads', direct: false }),
  ],
};

function harness(opts: { lang?: 'en' | 'es'; page?: string; response?: unknown; ok?: boolean } = {}) {
  (window as { __SO_HOME_LOCALE?: () => string }).__SO_HOME_LOCALE = () => opts.lang ?? 'en';
  const stage = { soDataSources: { highlight: vi.fn() } };
  const ws = document.createElement('div');
  ws.innerHTML = '<button data-lens="schedules"></button>';
  const ctx = {
    rbodyEl: document.createElement('div'),
    ws,
    panes: { a: { iframe: { contentWindow: stage }, page: opts.page ?? '' } } as Record<string, unknown>,
    activeKey: 'a',
    activeArt: null as Art | null,
    rActive: 'data',
    retried: 0,
    i18nLoad: () => 'loading',
    esc: (s: unknown) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    locTag: () => (opts.lang === 'es' ? 'es-AR' : 'en-US'),
    okOr: (r: { ok: boolean }) => (r.ok ? r : Promise.reject(new Error('HTTP'))),
    railRetry: () => { ctx.retried++; },
    fetchMeta: (art: Art, cb: (d: unknown) => void) => queueMicrotask(() => { art.id = 'art_1'; cb({ id: 'art_1' }); }),
    fetch: vi.fn((_url: string) => Promise.resolve({ ok: opts.ok !== false, json: () => Promise.resolve(opts.response ?? RESPONSE) })),
  };
  const run = new Function('ctx', `with (ctx) { ${DATA}; return { renderData: renderData, dataClear: dataClear }; }`)(ctx) as {
    renderData: (a: Art) => void;
    dataClear: () => void;
  };
  return { ctx, run, stage, lensClick: vi.spyOn(ws.querySelector('button')!, 'click') };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const rows = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>('.wsx-ds__src'));

afterEach(() => vi.restoreAllMocks());

describe('inspector Data tab', () => {
  it('is a lazy chunk the inspector opens as a tab, and parses', () => {
    expect(LAZY_CHUNKS.data.exports).toEqual(['renderData']);
    expect(LAZY_CHUNKS.data.soft).toEqual(['dataClear']);
    expect(() => new Function(lazyChunkBody('data'))).not.toThrow();
    expect(WORKSPACE_CLIENT).toContain("function renderData() { return wsxLazy('data', 'renderData', arguments); }");
    expect(WORKSPACE_CLIENT).toContain("moreRow('data', t('inspector.data'))");
    expect(() => new Function(WORKSPACE_CLIENT)).not.toThrow();
  });

  it('lists what the page reads, in the viewer\'s words, with the version it describes', async () => {
    const { ctx, run } = harness({ lang: 'es', page: 'pages/ventas.html' });
    const art = { id: 'art_1' };
    ctx.activeArt = art;
    run.renderData(art);
    await flush(); await flush();
    expect(ctx.fetch.mock.calls[0][0]).toBe('/v1/artifacts/art_1/sources?page=pages%2Fventas.html');
    const [snap, leads] = rows(ctx.rbodyEl);
    expect(rows(ctx.rbodyEl)).toHaveLength(2);
    expect(snap.textContent).toContain('Actualizado hace 2 h · por el job “Ads diario”');
    expect(snap.textContent).toContain('Alimenta: 2 elementos');
    expect(leads.textContent).toContain('Sin declarar');
    expect(ctx.rbodyEl.textContent).toContain('Según la versión publicada (v7).');
    expect(ctx.rbodyEl.querySelector('pre')?.textContent).toBe('SELECT spend FROM ads');
  });

  it('links to the lenses that manage a source, only when that lens exists here', async () => {
    const { ctx, run, lensClick } = harness();
    const art = { id: 'art_1' };
    ctx.activeArt = art;
    run.renderData(art);
    await flush(); await flush();
    const links = Array.from(ctx.rbodyEl.querySelectorAll<HTMLButtonElement>('[data-dslens]'));
    expect(links.map((b) => b.getAttribute('data-dslens'))).toEqual(['schedules']);
    links[0].click();
    expect(lensClick).toHaveBeenCalled();
  });

  it('outlines what a source feeds inside the stage, pins on click, and clears on leave', async () => {
    const { ctx, run, stage } = harness();
    const art = { id: 'art_1' };
    ctx.activeArt = art;
    run.renderData(art);
    await flush(); await flush();
    const [snap, leads] = rows(ctx.rbodyEl);
    snap.dispatchEvent(new Event('mouseenter'));
    expect(stage.soDataSources.highlight).toHaveBeenLastCalledWith('json:snapshot', ['#kpi'], false);
    leads.click();
    expect(leads.getAttribute('aria-pressed')).toBe('true');
    expect(stage.soDataSources.highlight).toHaveBeenLastCalledWith('table:leads', ['#leads'], true);
    snap.dispatchEvent(new Event('mouseleave'));
    expect(stage.soDataSources.highlight).toHaveBeenLastCalledWith('table:leads', ['#leads'], false);
    run.dataClear();
    expect(stage.soDataSources.highlight).toHaveBeenLastCalledWith(null, [], false);
  });

  it('waits for the artifact id, retries on failure, and never paints over another tab', async () => {
    const pending = harness();
    const art: Art = { slug: 'demo' };
    pending.ctx.activeArt = art;
    pending.run.renderData(art);
    await flush(); await flush(); await flush();
    expect(pending.ctx.fetch.mock.calls[0][0]).toBe('/v1/artifacts/art_1/sources');

    const failing = harness({ ok: false });
    const art2 = { id: 'art_1' };
    failing.ctx.activeArt = art2;
    failing.run.renderData(art2);
    await flush(); await flush();
    expect(failing.ctx.retried).toBe(1);

    const moved = harness();
    const art3 = { id: 'art_1' };
    moved.ctx.activeArt = art3;
    moved.run.renderData(art3);
    moved.ctx.rActive = 'details';
    moved.ctx.rbodyEl.innerHTML = 'details';
    await flush(); await flush();
    expect(moved.ctx.rbodyEl.innerHTML).toBe('details');
  });

  it('escapes author text', async () => {
    const { ctx, run } = harness({ response: { ...RESPONSE, sources: [src({ label: '<img src=x onerror=alert(1)>', description: '<b>x</b>' })] } });
    const art = { id: 'art_1' };
    ctx.activeArt = art;
    run.renderData(art);
    await flush(); await flush();
    expect(ctx.rbodyEl.querySelector('.wsx-ds__src img')).toBeNull();
    expect(ctx.rbodyEl.querySelector('.wsx-ds__src b')).toBeNull();
  });
});
