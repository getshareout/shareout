// Provenance derivation units: refs, the page scan (HTMLRewriter), and the merge rules
// that decide what each caller sees. The endpoint test covers the same rules end to end.
import { describe, expect, it } from 'vitest';
import { attrSelector, bindingRefs, cssEscapeIdent, idSelector, normalizeRef } from '../../../src/provenance/refs';
import { detectCodeRefs, resolveScriptPath, scanPage, type PageScan } from '../../../src/provenance/scan';
import { buildSources } from '../../../src/provenance/build';
import { crewToolEffects, jobTargets, toIso, type SourceFacts } from '../../../src/provenance/facts';
import type { DataSource } from '../../../src/provenance/types';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const ctx = { artifactId: 'art_x', workspaceId: 'wsp_x', now: NOW };
const VIEWER = { full: false, scoped: false };
const EDITOR = { full: true, scoped: false };
const SCOPED = { full: false, scoped: true };

function facts(over: Partial<SourceFacts> = {}): SourceFacts {
  return {
    connections: [], jobs: [], crews: [], syncs: [], datasets: new Map(), metrics: [], secrets: new Map(),
    files: new Map(), mcp: null, policyQueries: [], stamps: { json: new Map(), tables: new Map() }, ...over,
  };
}
const byKey = (list: DataSource[], key: string) => list.find((s) => s.key === key);

const PAGE = `<!doctype html><html><head>
<script type="shareout/manifest">${JSON.stringify({
  version: '2.0',
  sources: {
    json: { snapshot: { label: 'Ads snapshot', description: 'Spend and clicks per campaign', query: 'SELECT * FROM ads', as_of: '2026-10-20', refresh: 'daily' } },
    tables: { leads: { schema: [{ name: 'id', type: 'string', primary: true }] } },
    connections: { warehouse: { label: 'Warehouse', query: 'SELECT 1', tables: ['ADS.DAILY'], replication: { credentials: 'vault/bq.json' } } },
  },
  computed: { open: { formula: 'count(leads:status=open)' } },
  feeds: [{ element: '#spend-chart', source: 'connection:warehouse', note: 'Spend trend' }],
})}</script>
<script type="shareout/metrics">{"metrics":[{"id":"spend","label":"Spend","source":{"type":"json_path","key":"snapshot","path":"spend"}}]}</script>
<script src="/sdk/shareout.js"></script><script src="app.js"></script>
</head><body>
<span id="kpi-spend" data-shareout-binding="json:snapshot.spend" data-shareout-display="Spend">$0</span>
<span data-shareout-binding="json:snapshot.clicks">0</span>
<span data-shareout-binding="json:snapshot.clicks">0</span>
<b data-shareout-binding="computed:open">0</b>
<ul data-shareout-template="lead-list" data-shareout-template-source="table:leads">
  <li data-shareout-template-item><span data-shareout-binding="table:leads:row:$id:name"></span></li>
</ul>
<div id="spend-chart" data-shareout-chart='{"type":"line","title":"Spend by day"}' data-shareout-chart-data="json:snapshot"></div>
<table data-shareout-source="dataset:benchmarks" aria-label="Benchmarks"></table>
<script>
  (async () => {
    const so = await ShareOut.create();
    const s = await so.json.get('snapshot');
    const rows = await so.connection('warehouse').query('SELECT 1');
    const hits = await so.knowledge.search('q');
    so.table("leads").find().exec();
  })();
</script>
</body></html>`;

describe('refs', () => {
  it('reads binding expressions the way paintBindings does', () => {
    expect(bindingRefs('json:metrics.revenue.total')).toEqual(['json:metrics']);
    expect(bindingRefs('table:orders:sum:amount')).toEqual(['table:orders']);
    expect(bindingRefs('multi:ratio:json:a|table:orders:sum:amount')).toEqual(['json:a', 'table:orders']);
    expect(bindingRefs('computed:open', { open: { formula: 'count(leads:status=open)' } })).toEqual(['table:leads']);
    expect(bindingRefs('computed:x:json:a+table:b:count:id')).toEqual(['json:a', 'table:b']);
    expect(bindingRefs('computed:unknown')).toEqual([]);
  });

  it('keeps a data-shareout-source name whole (json keys may contain dots)', () => {
    expect(normalizeRef('json:metrics.v2')).toBe('json:metrics.v2');
    expect(normalizeRef('json:metrics.v2', true)).toBe('json:metrics');
    expect(normalizeRef('Connection:warehouse')).toBe('connection:warehouse');
    expect(normalizeRef('bogus:x')).toBeNull();
    expect(normalizeRef('json:<script>')).toBeNull();
  });

  it('builds selectors that survive odd ids and quotes', () => {
    expect(idSelector('kpi-spend')).toBe('#kpi-spend');
    expect(cssEscapeIdent('1st')).toBe('\\31 st');
    expect(attrSelector('data-shareout-binding', 'json:a"b')).toBe('[data-shareout-binding="json:a\\"b"]');
  });
});

describe('scanPage', () => {
  it('collects declared sources, fed elements, labels and SDK calls', async () => {
    const scan = await scanPage(PAGE, 'index.html');
    expect(scan.manifest?.jsonKeys).toEqual(['snapshot']);
    expect(scan.scriptPaths).toEqual(['app.js']);
    expect(scan.metricIds.has('spend')).toBe(true);
    expect([...scan.code.json]).toEqual(['snapshot']);
    expect([...scan.code.connections]).toEqual(['warehouse']);
    expect([...scan.code.tables]).toEqual(['leads']);
    expect(scan.code.knowledge).toBe(true);

    const kpi = scan.elements.find((e) => e.element_id === 'kpi-spend')!;
    expect(kpi).toMatchObject({ refs: ['json:snapshot'], selector: '#kpi-spend', label: 'Spend' });
    const chart = scan.elements.find((e) => e.element_id === 'spend-chart')!;
    expect(chart).toMatchObject({ refs: ['json:snapshot'], label: 'Spend by day' });
    // The template list is the feed; its per-item `$id` bindings are not.
    expect(scan.elements.filter((e) => e.refs.includes('table:leads')).map((e) => e.selector))
      .toEqual(['[data-shareout-binding="computed:open"]', '[data-shareout-template-source="table:leads"]']);
    expect(scan.elements.find((e) => e.refs.includes('dataset:benchmarks'))?.label).toBe('Benchmarks');
  });

  it('resolves only same-artifact script paths', () => {
    expect(resolveScriptPath('./js/app.js?v=2', 'pages/report.html')).toBe('pages/js/app.js');
    expect(resolveScriptPath('../app.js', 'pages/report.html')).toBe('app.js');
    expect(resolveScriptPath('/sdk/shareout.js', 'index.html')).toBeNull();
    expect(resolveScriptPath('https://cdn.example/x.js', 'index.html')).toBeNull();
    expect(resolveScriptPath('../../x.js', 'index.html')).toBeNull();
  });

  it('finds store calls in separate script files and file links', () => {
    const code = detectCodeRefs([
      "sdk.dataset('benchmarks').rows(); sdk.secrets.get('weather', '/today'); sdk.platform.provider('google-ads').execute('x');",
      "img.src = sdk.files.getUrl('dlv_abc'); fetch('/v1/files/dlv_def/content'); app.so.blobs.list();",
      'input.files.length; console.table(rows);',
    ]);
    expect([...code.datasets]).toEqual(['benchmarks']);
    expect([...code.secrets]).toEqual(['weather']);
    expect([...code.platforms]).toEqual(['google-ads']);
    expect([...code.files].sort()).toEqual(['dlv_abc', 'dlv_def']);
    expect(code.blobs).toBe(true);
    expect(code.tables.size).toBe(0);
  });
});

describe('facts helpers', () => {
  it('reads refresh targets from job configs', () => {
    expect(jobTargets('materialize', { connection: 'wh', query: 'SELECT 1', target: { type: 'table', name: 'daily' } }))
      .toEqual({ connection: 'wh', targets: [{ ref: 'table:daily', query: 'SELECT 1' }] });
    expect(jobTargets('query_snapshot', { connection: 'ads', queries: [
      { query: 'q1', target: { type: 'json', name: 'snapshot', path: 'spend' } },
      { query: 'q2', target: { type: 'dataset', name: 'raw' } },
      { query: 'q3', target: { type: 'nope', name: 'x' } },
    ] }).targets.map((t) => t.ref)).toEqual(['json:snapshot', 'dataset:raw']);
  });

  it('reads crew writes from logged tool inputs, even when the log was cut', () => {
    expect(crewToolEffects('json_set', JSON.stringify({ key: 'summary', value: 'x' }))).toEqual({ writes: ['json:summary'], reads: [] });
    expect(crewToolEffects('materialize_query', JSON.stringify({ connection: 'wh', query: 'q', target: { type: 'table', name: 'daily' } })))
      .toEqual({ writes: ['table:daily'], reads: ['wh'] });
    expect(crewToolEffects('table_insert', '{"table":"leads","rows":[{"id":"1","note":"very long…[truncated]'))
      .toEqual({ writes: ['table:leads'], reads: [] });
  });

  it('normalizes unix seconds and ISO timestamps', () => {
    expect(toIso('1761393600')).toBe('2025-10-25T12:00:00.000Z');
    expect(toIso('2026-10-25T10:00:00.000Z')).toBe('2026-10-25T10:00:00.000Z');
    expect(toIso(null)).toBeUndefined();
  });
});

describe('buildSources', () => {
  async function scanned(): Promise<PageScan> {
    return scanPage(PAGE, 'index.html');
  }
  const job = {
    id: 'job_1', name: 'Ads diario', schedule: '0 6 * * *', enabled: true, last_status: 'failed',
    last_run_at: '2026-10-25T06:00:00.000Z', last_ok_at: '2026-10-25T10:00:00.000Z', connection: 'warehouse',
    targets: [{ ref: 'json:snapshot', query: 'SELECT spend FROM ads' }],
  };
  const conn = { id: 'conn_1', scope: 'workspace' as const, name: 'warehouse', kind: 'platform' as const, provider: 'bigquery', credential_scope: 'shared' as const };

  it('gives viewers names, freshness and what each source feeds — never queries or connection ids', async () => {
    const list = buildSources(await scanned(), facts({ jobs: [job], connections: [conn] }), VIEWER, ctx);
    const snap = byKey(list, 'json:snapshot')!;
    expect(snap).toMatchObject({
      kind: 'json', label: 'Ads snapshot', description: 'Spend and clicks per campaign', declared: true, direct: true,
      provider: 'shareout', provider_label: null, access: 'summary', upstream: ['connection:warehouse'],
      freshness: { as_of: '2026-10-20', refresh: 'daily', last_refresh_at: '2026-10-25T10:00:00.000Z', refresher: { type: 'job', name: 'Ads diario', schedule: '0 6 * * *' } },
    });
    expect(snap.feed_count).toBe(4);
    expect(snap.feeds.map((f) => f.selector)).toEqual(['#kpi-spend', '[data-shareout-binding="json:snapshot.clicks"]', '#spend-chart']);
    expect(list.every((s) => s.details === undefined)).toBe(true);
    expect(JSON.stringify(list)).not.toContain('SELECT');
    expect(JSON.stringify(list)).not.toContain('conn_1');
    expect(JSON.stringify(list)).not.toContain('vault/bq.json');

    const wh = byKey(list, 'connection:warehouse')!;
    expect(wh).toMatchObject({ label: 'Warehouse', provider: 'bigquery', provider_label: 'BigQuery', freshness: { refresher: { type: 'live' } } });
    expect(wh.feeds).toEqual([{ selector: '#spend-chart', label: 'Spend trend' }]);
    expect(byKey(list, 'knowledge:workspace')?.freshness.refresher).toEqual({ type: 'live' });
    expect(byKey(list, 'table:leads')?.feed_count).toBe(2);
  });

  it('gives editors the query, the connection and every refresher', async () => {
    const list = buildSources(await scanned(), facts({ jobs: [job], connections: [conn] }), EDITOR, ctx);
    expect(byKey(list, 'json:snapshot')?.details).toMatchObject({
      query: 'SELECT * FROM ads',
      refreshers: [{ type: 'job', id: 'job_1', name: 'Ads diario', enabled: true, last_status: 'failed' }],
      manage: { jobs: '/home?workspace=wsp_x&view=schedules' },
    });
    expect(byKey(list, 'connection:warehouse')?.details).toMatchObject({
      query: 'SELECT 1', tables: ['ADS.DAILY'], replication: { credentials: 'vault/bq.json' },
      connection: { id: 'conn_1', name: 'warehouse', scope: 'workspace', kind: 'platform', credential_scope: 'shared' },
      manage: { connections: '/home?workspace=wsp_x&view=connectors' },
    });
  });

  it('says nothing it cannot back: undeclared stays undeclared, unknown freshness stays empty', async () => {
    const list = buildSources(await scanned(), facts(), VIEWER, ctx);
    const bench = byKey(list, 'dataset:benchmarks')!;
    expect(bench.declared).toBe(false);
    expect(bench.freshness).toEqual({});
    expect(byKey(list, 'table:leads')?.freshness).toEqual({});
  });

  it('hides server-only names from viewers behind opaque keys', async () => {
    const hidden = { ...job, connection: 'client_x_ads', targets: [{ ref: 'json:raw_client_x' }] };
    const list = buildSources(await scanned(), facts({ jobs: [hidden], connections: [{ ...conn, name: 'client_x_ads', provider: 'google-ads' }] }), VIEWER, ctx);
    expect(JSON.stringify(list)).not.toContain('client_x');
    const store = list.find((s) => s.key === 'json:~1' || s.key === 'json:~2')!;
    expect(store.freshness.refresher?.name).toBe('Ads diario');
    const upstream = list.find((s) => s.key === store.upstream[0])!;
    expect(upstream).toMatchObject({ kind: 'connection', label: 'Google Ads', direct: false });
  });

  it('policy-scoped viewers: page-source names only, no refresher names, scheduled times only', async () => {
    const crew = {
      id: 'crew_1', name: 'Client X follow-up', active: true, schedule: undefined,
      writes: new Map([['table:leads', '2026-10-25T11:00:00.000Z']]), scheduledWrites: new Map<string, string | undefined>(), reads: new Set<string>(),
    };
    const stamps = { json: new Map([['snapshot', '2026-10-25T11:59:00.000Z']]), tables: new Map() };
    const list = buildSources(await scanned(), facts({
      jobs: [job, { ...job, id: 'job_2', name: 'Client X raw', targets: [{ ref: 'json:client_x_raw' }] }],
      crews: [crew], connections: [conn], stamps,
      metrics: [{ id: 'other', label: 'Client X revenue', source: { type: 'table_count', table: 'leads' } }],
    }), SCOPED, ctx);
    const text = JSON.stringify(list);
    expect(text).not.toContain('Client X');
    expect(text).not.toContain('client_x');
    expect(text).not.toContain('Ads diario');
    expect(byKey(list, 'json:snapshot')?.freshness).toMatchObject({
      last_refresh_at: '2026-10-25T10:00:00.000Z', refresher: { type: 'job', schedule: '0 6 * * *' },
    });
    // The crew only ran on demand: its timing is not something a scoped viewer learns.
    expect(byKey(list, 'table:leads')?.freshness.last_refresh_at).toBeUndefined();
    expect(byKey(list, 'metric:other')).toBeUndefined();
  });

  it('policy queries are live sources a scoped viewer sees, without the connection name', async () => {
    const policyQueries = [{ name: 'sales', connection: 'client_x_wh', provider: 'snowflake', sql: 'SELECT * FROM sales' }];
    const scoped = buildSources(null, facts({ policyQueries }), SCOPED, ctx);
    expect(scoped).toEqual([expect.objectContaining({
      key: 'connection:~1', kind: 'connection', label: 'Snowflake', declared: true, direct: true,
      freshness: { refresher: { type: 'live' } },
    })]);
    expect(JSON.stringify(scoped)).not.toMatch(/client_x|SELECT/);
    const editor = buildSources(null, facts({ policyQueries }), EDITOR, ctx);
    expect(editor[0]).toMatchObject({ key: 'connection:client_x_wh', details: { query: 'SELECT * FROM sales', missing_connection: 'client_x_wh' } });
  });

  it('metrics: declared in the page, fed by the bound number, as fresh as their store', async () => {
    const list = buildSources(await scanned(), facts({
      jobs: [job],
      metrics: [{ id: 'spend', label: 'Spend', source: { type: 'json_path', key: 'snapshot', path: 'spend' } }],
    }), VIEWER, ctx);
    expect(byKey(list, 'metric:spend')).toMatchObject({
      kind: 'metric', label: 'Spend', declared: true, upstream: ['json:snapshot'],
      feeds: [{ selector: '#kpi-spend', element_id: 'kpi-spend', label: 'Spend' }],
      freshness: { last_refresh_at: '2026-10-25T10:00:00.000Z' },
    });
  });

  it('MCP connections run live as the viewer; tools are editor detail', async () => {
    const mcp = { connections: [{ name: 'hubspot', tools: ['search_deals'] }] };
    const mcpRow = { id: 'conn_m', scope: 'workspace' as const, name: 'hubspot', kind: 'platform' as const, provider: 'mcp', credential_scope: 'per_user' as const, host: 'mcp.hubspot.test' };
    const viewer = byKey(buildSources(null, facts({ mcp, connections: [mcpRow] }), VIEWER, ctx), 'mcp:hubspot')!;
    expect(viewer).toMatchObject({ kind: 'mcp', declared: true, provider: 'mcp', freshness: { refresher: { type: 'live' } } });
    expect(viewer.details).toBeUndefined();
    const editor = byKey(buildSources(null, facts({ mcp, connections: [mcpRow] }), EDITOR, ctx), 'mcp:hubspot')!;
    expect(editor.details).toMatchObject({ tools: ['search_deals'], connection: { id: 'conn_m', credential_scope: 'per_user' } });
  });

  it('flags a source as stale past seven days; the newest of observed and declared dates wins', async () => {
    const old = { ...job, last_ok_at: '2026-10-01T00:00:00.000Z', targets: [{ ref: 'table:leads' }, { ref: 'json:snapshot' }] };
    const list = buildSources(await scanned(), facts({ jobs: [old] }), VIEWER, ctx);
    expect(byKey(list, 'table:leads')?.freshness.stale).toBe(true);
    // snapshot declares as_of 2026-10-20: five days old, not stale.
    expect(byKey(list, 'json:snapshot')?.freshness.stale).toBeUndefined();
  });

  it('a page with no data has no sources', async () => {
    const scan = await scanPage('<!doctype html><h1>Hola</h1>', 'index.html');
    expect(buildSources(scan, facts(), VIEWER, ctx)).toEqual([]);
  });
});
