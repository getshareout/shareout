import { describe, expect, it } from 'vitest';
import {
  detectComponents,
  getComponentEditorConfig,
} from '../../../src/editor/detector';
import type { DetectedComponent } from '../../../src/editor/types';

describe('detectComponents', () => {
  it('returns empty result for plain HTML', () => {
    const result = detectComponents('<html><body><h1>Hello</h1></body></html>');
    expect(result.sdkComponents).toEqual([]);
    expect(result.charts).toEqual([]);
    expect(result.widgets).toEqual([]);
  });

  it('detects SDK table and realtime components with names', () => {
    const html = `
      <div id="metrics">
        <script>
          sdk.table('sales_data');
          sdk.realtime('live_doc');
          sdk.json.set({ key: 'theme', value: 'dark' });
        </script>
      </div>
    `;
    const { sdkComponents } = detectComponents(html);

    const table = sdkComponents.find((c) => c.type === 'table');
    const realtime = sdkComponents.find((c) => c.type === 'realtime');
    const json = sdkComponents.find((c) => c.type === 'json');

    expect(table?.name).toBe('sales_data');
    expect(table?.selector).toBe('#metrics');
    expect(realtime?.name).toBe('live_doc');
    expect(json?.config).toEqual({ key: 'theme', value: 'dark' });
  });

  it('detects multiple SDK component types', () => {
    const html = `
      <div class="panel">
        sdk.blobs.upload();
        sdk.comments.init();
        sdk.sheets.connect();
        sdk.github.export();
        sdk.collaborators.list();
        sdk.agent.configure();
        sdk.slides.init();
        data-shareout-binding="user.name"
        Bindings.wrap(el);
      </div>
    `;
    const types = detectComponents(html).sdkComponents.map((c) => c.type);
    expect(types).toEqual(expect.arrayContaining([
      'blobs', 'comments', 'sheets', 'github', 'collaborators', 'agent', 'slides', 'binding',
    ]));
  });

  it('detects chart libraries and infers chart types', () => {
    const html = `
      <div id="chart-area">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <script>new Chart(ctx, { type: 'line', data: {} });</script>
        <script>echarts.init(document.getElementById('pie')).setOption({});</script>
        <script>Plotly.newPlot('scatter', data);</script>
        <script>d3.select('#bar').append('svg');</script>
        <script>new ApexCharts(el, { series: [] });</script>
      </div>
    `;
    const { charts } = detectComponents(html);
    const libraries = charts.map((c) => c.library);

    expect(libraries).toEqual(expect.arrayContaining([
      'chartjs', 'echarts', 'plotly', 'd3', 'apexcharts',
    ]));
    expect(charts.find((c) => c.library === 'chartjs')?.chartType).toBe('line');
  });

  it('detects recharts JSX patterns', () => {
    const html = `import { LineChart, BarChart } from 'recharts'; <LineChart data={data} />`;
    const { charts } = detectComponents(html);
    expect(charts.some((c) => c.library === 'recharts')).toBe(true);
  });

  it('detects widgets by class and data attributes', () => {
    const html = `
      <div class="kpi-card" id="kpi1">Revenue</div>
      <table data-sortable><tr><td>A</td></tr></table>
      <div data-filter-target="chart1"></div>
      <iframe src="https://example.com/embed"></iframe>
    `;
    const { widgets } = detectComponents(html);
    const types = widgets.map((w) => w.type);

    expect(types).toEqual(expect.arrayContaining(['kpi', 'table', 'filter', 'embed']));
    const kpi = widgets.find((w) => w.type === 'kpi');
    expect(kpi?.selector).toMatch(/^(\.kpi-card|#kpi1|div)$/);
  });

  it('deduplicates components with same type, name, and selector', () => {
    const html = `
      <div id="dup">
        sdk.table('orders');
        sdk.table('orders');
      </div>
    `;
    const tables = detectComponents(html).sdkComponents.filter((c) => c.type === 'table');
    expect(tables).toHaveLength(1);
  });

  it('falls back to tag or body selector when no id/class nearby', () => {
    const html = '<section><script>shareout.json.get("key")</script></section>';
    const comp = detectComponents(html).sdkComponents[0];
    expect(['section', 'body']).toContain(comp.selector.replace(/^[.#]/, ''));
  });

  it('uses first non-internal class when id is absent', () => {
    const html = '<div class="wrapper __internal"><script>sdk.agent.chat()</script></div>';
    const comp = detectComponents(html).sdkComponents.find((c) => c.type === 'agent');
    expect(comp?.selector).toBe('.wrapper');
  });
});

describe('getComponentEditorConfig', () => {
  const types = [
    'json', 'table', 'blobs', 'comments', 'realtime', 'sheets',
    'github', 'collaborators', 'agent', 'slides', 'binding',
  ] as const;

  it.each(types)('returns panel config for %s', (type) => {
    const component = { type, selector: '#x' } as DetectedComponent;
    const config = getComponentEditorConfig(component);
    expect(config.title).toBeTruthy();
    expect(config.icon).toBeTruthy();
    expect(config.fields.length).toBeGreaterThan(0);
  });

  it('includes component name in table and realtime titles', () => {
    expect(getComponentEditorConfig({ type: 'table', name: 'Users', selector: '#t' }).title)
      .toContain('Users');
    expect(getComponentEditorConfig({ type: 'realtime', name: 'Doc1', selector: '#r' }).title)
      .toContain('Doc1');
  });

  it('uses fallback titles when name is missing', () => {
    expect(getComponentEditorConfig({ type: 'table', selector: '#t' }).title).toContain('Untitled');
    expect(getComponentEditorConfig({ type: 'binding', selector: '#b' }).title).toContain('Value');
  });
});
