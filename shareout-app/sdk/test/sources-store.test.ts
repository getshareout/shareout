// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SourcesStore } from '../src/stores/sources-store';
import type { SdkClient } from '../src/core/sdk-client';

const stubClient = {} as SdkClient;

function setManifest(manifest: unknown, bodyHtml = '') {
  document.head.innerHTML = `<script type="shareout/manifest">${JSON.stringify(manifest)}</script>`;
  document.body.innerHTML = bodyHtml;
}

const MANIFEST = {
  version: '2.0',
  sources: {
    connections: {
      warehouse: {
        label: 'Warehouse',
        description: 'Snowflake ANALYTICS_WH',
        query: 'SELECT * FROM companies',
        tables: ['PRODUCTION.DIM_COMPANIES'],
        refresh: 'daily 12:00 UTC',
        as_of: '2026-06-22',
        replication: { build: 'python build.py', publish: 'node publish.mjs', credentials: 'creds.json' },
      },
    },
    json: { revenue: { description: 'Cached revenue', default: {} } },
  },
  feeds: [{ element: '#chart', source: 'connection:warehouse', note: 'fed by warehouse' }],
};

describe('SourcesStore', () => {
  beforeEach(() => {
    document.getElementById('so-sources-root')?.remove();
    document.getElementById('so-sources-css')?.remove();
  });
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('lists declared sources with provenance', () => {
    setManifest(MANIFEST);
    const list = new SourcesStore(stubClient).list();
    expect(list.map((s) => s.ref)).toEqual(['connection:warehouse', 'json:revenue']);
    const wh = list[0];
    expect(wh.query).toBe('SELECT * FROM companies');
    expect(wh.refresh).toBe('daily 12:00 UTC');
    expect(wh.asOf).toBe('2026-06-22');
    expect(wh.replication?.build).toBe('python build.py');
  });

  it('get() resolves by ref or bare key, feeds() returns mappings', () => {
    setManifest(MANIFEST);
    const s = new SourcesStore(stubClient);
    expect(s.get('connection:warehouse')?.key).toBe('warehouse');
    expect(s.get('warehouse')?.ref).toBe('connection:warehouse');
    expect(s.feeds()).toHaveLength(1);
  });

  it('returns empty list when no manifest present', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    expect(new SourcesStore(stubClient).list()).toEqual([]);
    expect(new SourcesStore(stubClient).manifest()).toBeNull();
  });

  it('mount() renders a drawer with a card per source', () => {
    setManifest(MANIFEST, '<div id="chart"></div>');
    const ctrl = new SourcesStore(stubClient).mount();
    const root = document.getElementById('so-sources-root');
    expect(root).not.toBeNull();
    expect(root!.querySelectorAll('.so-src-card')).toHaveLength(2);
    expect(root!.querySelector('.so-src-q pre')?.textContent).toContain('SELECT * FROM companies');
    ctrl.destroy();
    expect(document.getElementById('so-sources-root')).toBeNull();
  });

  it('attaches a "where from?" badge to feed-mapped and data-shareout-source elements', () => {
    setManifest(MANIFEST, '<div id="chart"></div><table data-shareout-source="json:revenue"></table>');
    new SourcesStore(stubClient).mount();
    expect(document.querySelector('#chart .so-src-badge')).not.toBeNull();
    expect(document.querySelector('table .so-src-badge')).not.toBeNull();
  });

  it('open(ref) opens the drawer and highlights the matching card', () => {
    setManifest(MANIFEST);
    const s = new SourcesStore(stubClient);
    s.mount();
    s.open('connection:warehouse');
    const root = document.getElementById('so-sources-root')!;
    expect(root.classList.contains('open')).toBe(true);
    expect(root.querySelector('.so-src-card.hl')).not.toBeNull();
  });
});
