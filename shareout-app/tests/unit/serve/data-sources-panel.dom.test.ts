// @vitest-environment happy-dom
// The viewer's Data sources panel: shown when the artifact frame says it shows data,
// one same-origin fetch, ES/EN copy, highlight messages to the frame, keyboard and focus.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDataSourcesPanel } from '../../../src/serve/sandbox-viewer/data-sources';
import type { DataSource, SourcesResponse } from '../../../src/provenance/types';

type Posted = { type: string; ref?: string | null; selectors?: string[]; scroll?: boolean };

let frameWin: { postMessage: ReturnType<typeof vi.fn> };
let fetchMock: ReturnType<typeof vi.fn>;
const added: Array<[string, EventListenerOrEventListenerObject]> = [];

const HOUR = 3_600_000;
const source = (over: Partial<DataSource>): DataSource => ({
  key: 'json:snapshot', kind: 'json', label: 'Resumen de pauta', provider: 'shareout', provider_label: null,
  declared: true, direct: true, freshness: {}, feeds: [], feed_count: 0, upstream: [], access: 'summary', ...over,
});
const RESPONSE: SourcesResponse = {
  artifact_id: 'art_1', version: { id: 'ver_1', number: 3, page: 'index.html' }, access: 'summary', scoped: false,
  sources: [
    source({
      freshness: { last_refresh_at: new Date(Date.now() - 2 * HOUR - 60_000).toISOString(), refresher: { type: 'job', name: 'Ads diario', schedule: '0 6 * * *' } },
      feeds: [{ selector: '#kpi' }, { selector: '[data-shareout-binding="json:snapshot.clicks"]' }], feed_count: 3,
      upstream: ['connection:~1'],
    }),
    source({ key: 'table:leads', kind: 'table', label: 'leads', declared: false, freshness: { as_of: '2026-01-02', stale: true }, feed_count: 1, feeds: [{ selector: '#leads' }] }),
    source({ key: 'mcp:hub', kind: 'mcp', label: 'hub', provider: 'mcp', provider_label: 'MCP', freshness: { refresher: { type: 'live' } } }),
    source({ key: 'connection:~1', kind: 'connection', label: 'connection', provider: 'google-ads', provider_label: 'Google Ads', direct: false, declared: false }),
  ],
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function boot(opts: { locale?: 'en' | 'es'; visible?: boolean; toolbar?: boolean } = {}) {
  document.body.innerHTML = `<iframe></iframe>${opts.toolbar ? '<div id="shareout-admin-toolbar"><div id="so-toolbar-items"></div><button id="so-toolbar-trigger"></button></div>' : ''}`;
  frameWin = { postMessage: vi.fn() };
  Object.defineProperty(document.querySelector('iframe')!, 'contentWindow', { value: frameWin });
  const html = renderDataSourcesPanel({ artifactId: 'art_1', page: 'index.html', locale: opts.locale ?? 'en', visible: !!opts.visible, withVars: !opts.toolbar });
  const markup = html.slice(0, html.indexOf('<script>'));
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  document.body.insertAdjacentHTML('beforeend', markup);
  const original = window.addEventListener.bind(window);
  window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: unknown) => {
    added.push([type, fn]);
    return original(type, fn, o as AddEventListenerOptions);
  }) as typeof window.addEventListener;
  try {
    eval(js);
  } finally {
    window.addEventListener = original;
  }
}

function fromFrame(data: unknown, source: unknown = frameWin) {
  const ev = new MessageEvent('message', { data });
  Object.defineProperty(ev, 'source', { value: source });
  window.dispatchEvent(ev);
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const pill = () => document.getElementById('so-ds-pill') as HTMLButtonElement;
const panel = () => document.getElementById('so-ds-panel') as HTMLElement;
const highlights = (): Posted[] => frameWin.postMessage.mock.calls.map((c) => c[0] as Posted).filter((m) => m.type === 'shareout:sources:highlight');
const rows = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.so-ds-src'));

async function openPanel(body: unknown = RESPONSE, status = 200) {
  fetchMock.mockResolvedValueOnce(json(status, body));
  fromFrame({ type: 'shareout:sources:hint' });
  pill().click();
  await flush(); await flush();
}

beforeEach(() => {
  delete (window as { soDataSources?: unknown }).soDataSources;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  for (const [type, fn] of added.splice(0)) window.removeEventListener(type, fn);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Data pill', () => {
  it('stays hidden until our own artifact frame says the page shows data', () => {
    boot();
    expect(pill().hidden).toBe(true);
    expect(frameWin.postMessage).toHaveBeenCalledWith({ type: 'shareout:sources:ping' }, '*');
    fromFrame({ type: 'shareout:sources:hint' }, window);
    fromFrame({ type: 'shareout:sources:hint' }, {});
    expect(pill().hidden).toBe(true);
    fromFrame({ type: 'shareout:sources:hint' });
    expect(pill().hidden).toBe(false);
    expect(pill().textContent?.trim()).toBe('Data');
  });

  it('shows at once on pages that declare live connections', () => {
    boot({ visible: true });
    expect(pill().hidden).toBe(false);
  });

  it('sits next to the toolbar trigger when there is a toolbar', () => {
    boot({ toolbar: true, locale: 'es' });
    expect(pill().parentElement?.id).toBe('shareout-admin-toolbar');
    expect(pill().nextElementSibling?.id).toBe('so-toolbar-trigger');
    expect(document.getElementById('so-ds-dock')).toBeNull();
    expect(pill().textContent?.trim()).toBe('Datos');
  });
});

describe('Data sources panel', () => {
  it('loads once, same-origin, and lists what the page reads with freshness and feeds', async () => {
    boot();
    await openPanel();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/v1/artifacts/art_1/sources?page=index.html');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' });
    expect(panel().hidden).toBe(false);
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.id).toBe('so-ds-title');

    const items = rows();
    // Upstream-only sources are not rows; they name where a row's data comes from.
    expect(items.map((b) => b.getAttribute('data-ref'))).toEqual(['json:snapshot', 'table:leads', 'mcp:hub']);
    const first = items[0].textContent!;
    expect(first).toContain('Resumen de pauta');
    expect(first).toContain('From Google Ads · Updated 2 h ago · by the job “Ads diario”');
    expect(first).toContain('Feeds: 3 elements');
    expect(items[1].textContent).toContain('Not declared');
    expect(items[1].textContent).toContain('Data as of Jan 2, 2026');
    expect(items[1].textContent).toContain('May be out of date');
    expect(items[1].textContent).toContain('Feeds: 1 element');
    expect(items[2].textContent).toContain('Live, with your own account');
    expect(items[2].textContent).toContain('Not linked to elements on the page');
    expect(document.getElementById('so-ds-foot')!.hidden).toBe(false);
    expect(document.querySelector('.so-ds-more')).toBeNull();

    pill().click();
    pill().click();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('speaks Rioplatense Spanish', async () => {
    boot({ locale: 'es' });
    await openPanel({ ...RESPONSE, sources: [RESPONSE.sources[0], { ...RESPONSE.sources[1], declared: true }, RESPONSE.sources[3]] });
    const [a, b] = rows();
    expect(document.getElementById('so-ds-title')!.textContent).toBe('Fuentes de datos');
    expect(a.textContent).toContain('Desde Google Ads · Actualizado hace 2 h · por el job “Ads diario”');
    expect(a.textContent).toContain('Alimenta: 3 elementos');
    expect(b.textContent).toContain('Datos al 2 ene 2026');
    expect(b.textContent).toContain('Alimenta: 1 elemento');
    expect(document.getElementById('so-ds-foot')!.textContent).toContain('solo las ve quien puede editar');
  });

  it('highlights on hover and focus, pins on click, and clears on close', async () => {
    boot();
    await openPanel();
    const [snap, leads] = rows();
    snap.dispatchEvent(new Event('mouseenter'));
    expect(highlights().at(-1)).toEqual({
      type: 'shareout:sources:highlight', ref: 'json:snapshot',
      selectors: ['#kpi', '[data-shareout-binding="json:snapshot.clicks"]'], scroll: false,
    });
    snap.dispatchEvent(new Event('mouseleave'));
    expect(highlights().at(-1)).toMatchObject({ ref: null, selectors: [] });

    leads.click();
    expect(leads.getAttribute('aria-pressed')).toBe('true');
    expect(highlights().at(-1)).toMatchObject({ ref: 'table:leads', selectors: ['#leads'], scroll: true });
    snap.dispatchEvent(new Event('focus'));
    snap.dispatchEvent(new Event('blur'));
    expect(highlights().at(-1)).toMatchObject({ ref: 'table:leads', scroll: false });

    panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel().hidden).toBe(true);
    expect(highlights().at(-1)).toMatchObject({ ref: null });
    expect(leads.getAttribute('aria-pressed')).toBe('false');
    expect(pill().getAttribute('aria-expanded')).toBe('false');
  });

  it('says so when the page uses no connected data', async () => {
    boot({ locale: 'es' });
    await openPanel({ ...RESPONSE, sources: [] });
    expect(document.getElementById('so-ds-body')!.textContent).toBe('Esta página no usa datos conectados.');
    expect(document.getElementById('so-ds-status')!.textContent).toBe('Esta página no usa datos conectados.');
    expect(document.getElementById('so-ds-foot')!.hidden).toBe(true);
  });

  it('offers a retry when loading fails', async () => {
    boot();
    await openPanel({ error: 'x', code: 'INTERNAL_ERROR' }, 500);
    expect(document.getElementById('so-ds-body')!.textContent).toContain("Couldn't load the sources. Try again?");
    fetchMock.mockResolvedValueOnce(json(200, RESPONSE));
    document.querySelector<HTMLButtonElement>('.so-ds-retry')!.click();
    await flush(); await flush();
    expect(rows()).toHaveLength(3);
  });

  it('editors get the query, connection and where to manage it — and no editors-only note', async () => {
    boot();
    await openPanel({
      ...RESPONSE,
      access: 'full',
      sources: [source({
        access: 'full',
        details: {
          query: 'SELECT spend FROM ads.daily',
          connection: { id: 'conn_1', name: 'warehouse', scope: 'workspace', kind: 'platform', credential_scope: 'per_user' },
          refreshers: [{ type: 'job', id: 'job_1', name: 'Ads diario', schedule: '0 6 * * *', enabled: true, last_status: 'failed' }],
          replication: { credentials: 'vault/bq.json' },
          manage: { connections: '/home?workspace=wsp_1&view=connectors' },
        },
      })],
    });
    const more = document.querySelector('.so-ds-more')!;
    expect(more.querySelector('pre')!.textContent).toBe('SELECT spend FROM ads.daily');
    expect(more.textContent).toContain("warehouse · shared in the workspace · each person's own credentials");
    expect(more.textContent).toContain('Job “Ads diario” · 0 6 * * * · last run failed');
    expect(more.textContent).toContain('vault/bq.json');
    const link = more.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/home?workspace=wsp_1&view=connectors');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(document.getElementById('so-ds-foot')!.hidden).toBe(true);
  });

  it('never renders author text as markup', async () => {
    boot();
    await openPanel({ ...RESPONSE, sources: [source({ label: '<img src=x onerror="window.__pwned=1">', description: '<b>bold</b>' })] });
    expect(document.querySelector('.so-ds-src img')).toBeNull();
    expect(document.querySelector('.so-ds-src b')).toBeNull();
    expect(rows()[0].textContent).toContain('<img src=x');
  });

  it('exposes the frame bridge for Studio and editors', () => {
    boot();
    (window as unknown as { soDataSources: { highlight: (r: string, s: string[], scroll: boolean) => void } }).soDataSources
      .highlight('json:snapshot', ['#kpi'], true);
    expect(highlights().at(-1)).toEqual({ type: 'shareout:sources:highlight', ref: 'json:snapshot', selectors: ['#kpi'], scroll: true });
  });
});
