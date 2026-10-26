// Data tab → Sources: the endpoint's list in the shared words, the "connected to" mapping,
// and canvas outlines that never leak into the saved page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  outlineOnCanvas,
  renderSourcesMarkup,
  renderSourcesSection,
  resetSourcesCache,
  sourcesLocale,
} from '../src/rail/sources-section';
import { DATA_SOURCES_COPY } from '../../shared/data-sources/copy';
import { createSourceFormatter } from '../../shared/data-sources/format';
import { stripEditorAttributes } from '../src/dom/editor-ids';
import type { EditorContext } from '../src/editor/context';
import type { DataSource, SourcesResponse } from '../../shared/data-sources/types';

const src = (over: Partial<DataSource>): DataSource => ({
  key: 'json:snapshot', kind: 'json', label: 'Resumen de pauta', provider: 'shareout', provider_label: null,
  declared: true, direct: true, freshness: {}, feeds: [], feed_count: 0, upstream: [], access: 'full', ...over,
});
const RESPONSE: SourcesResponse = {
  artifact_id: 'art_1', version: { id: 'ver_1', number: 4, page: 'index.html' }, access: 'full', scoped: false,
  sources: [
    src({
      feeds: [{ selector: '#kpi', element_id: 'kpi', label: 'Inversión' }, { selector: '[data-shareout-binding="json:snapshot.clicks"]' }],
      feed_count: 3,
      freshness: { as_of: '2026-06-22' },
      details: { query: 'SELECT spend FROM ads', manage: { jobs: '/home?view=schedules' } },
    }),
    src({ key: 'table:leads', kind: 'table', label: 'leads', declared: false }),
    src({ key: 'connection:~1', kind: 'connection', label: 'connection', provider_label: 'Google Ads', direct: false }),
  ],
};
const CANVAS = `<!doctype html><html><body>
  <span id="kpi" data-shareout-binding="json:snapshot.spend">$0</span>
  <span data-shareout-binding="json:snapshot.clicks">0</span>
  <span data-shareout-binding="json:snapshot.clicks">0</span>
  <p id="other">x</p></body></html>`;

function editorCtx(): EditorContext & { selected: Element[] } {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frame.contentDocument!.open();
  frame.contentDocument!.write(CANVAS);
  frame.contentDocument!.close();
  const selected: Element[] = [];
  return {
    config: { artifactId: 'art_1', slug: 's', baseUrl: '', theme: 'light' },
    dom: { canvasFrame: frame },
    selectElement: (el: Element | null) => { if (el) selected.push(el); },
    selected,
  } as unknown as EditorContext & { selected: Element[] };
}

beforeEach(() => resetSourcesCache());
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Sources in the editor Data tab', () => {
  it('picks Spanish for Spanish browsers', () => {
    expect(sourcesLocale('es-AR')).toBe('es');
    expect(sourcesLocale('en-US')).toBe('en');
    expect(sourcesLocale('')).toBe('en');
  });

  it('lists what the page reads with the shared words and the elements each source feeds', () => {
    const html = renderSourcesMarkup(RESPONSE, DATA_SOURCES_COPY.es, createSourceFormatter(DATA_SOURCES_COPY.es, 'es'));
    const box = document.createElement('div');
    box.innerHTML = html;
    expect(box.querySelectorAll('[data-src-ref]')).toHaveLength(2);
    expect(box.textContent).toContain('Fuentes de datos');
    expect(box.textContent).toContain('Datos al 22 jun 2026');
    expect(box.textContent).toContain('Sin declarar');
    expect(box.querySelector('.data-src-feeds summary')?.textContent).toBe('Alimenta: 3 elementos');
    expect([...box.querySelectorAll('[data-feed-sel]')].map((b) => b.textContent)).toEqual(['Inversión', '[data-shareout-binding="json:snapshot.clicks"]']);
    expect(box.querySelector('.data-src-more pre')?.textContent).toBe('SELECT spend FROM ads');
    expect(box.textContent).toContain('Según la versión publicada (v4).');
  });

  it('outlines a source on the canvas with the editor hover mark, which saving strips', () => {
    const ctx = editorCtx();
    expect(outlineOnCanvas(ctx, ['#kpi', '[data-shareout-binding="json:snapshot.clicks"]', '::bad('])).toBe(3);
    const doc = ctx.dom.canvasFrame.contentDocument!;
    expect(doc.querySelectorAll('[data-editor-hover]')).toHaveLength(3);
    expect(stripEditorAttributes(`<!doctype html>${doc.documentElement.outerHTML}`)).not.toContain('data-editor-hover');
    outlineOnCanvas(ctx, []);
    expect(doc.querySelectorAll('[data-editor-hover]')).toHaveLength(0);
  });

  it('loads once a minute, wires hover outlines and jumps to a fed element', async () => {
    const ctx = editorCtx();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(RESPONSE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const host = document.createElement('div');
    document.body.appendChild(host);
    await renderSourcesSection(ctx, host);
    await renderSourcesSection(ctx, host);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/v1/artifacts/art_1/sources');

    const row = host.querySelector<HTMLElement>('[data-src-ref="json:snapshot"]')!;
    row.dispatchEvent(new Event('mouseenter'));
    const doc = ctx.dom.canvasFrame.contentDocument!;
    expect(doc.querySelectorAll('[data-editor-hover]')).toHaveLength(3);
    row.dispatchEvent(new Event('mouseleave'));
    expect(doc.querySelectorAll('[data-editor-hover]')).toHaveLength(0);

    host.querySelector<HTMLButtonElement>('[data-feed-sel="#kpi"]')!.click();
    expect(ctx.selected.map((el) => el.id)).toEqual(['kpi']);
  });

  it('stays quiet for a page that was never published, and says so when loading fails', async () => {
    const ctx = editorCtx();
    const host = document.createElement('div');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    await renderSourcesSection(ctx, host);
    expect(host.innerHTML).toBe('');
    resetSourcesCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await renderSourcesSection(ctx, host);
    expect(host.textContent).toContain(DATA_SOURCES_COPY[sourcesLocale()].error);
  });
});
