// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShareOutCharts, { type ChartConfig } from '../src/charts';

function mockPlotly() {
  return {
    newPlot: vi.fn(async () => undefined),
    react: vi.fn(async () => undefined),
    purge: vi.fn(),
  };
}

function baseConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    id: 'chart-1',
    type: 'line',
    title: 'Revenue',
    series: [{ name: 'Q1', data: [10, 20, 30] }],
    categories: ['Jan', 'Feb', 'Mar'],
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="chart-host"></div>';
  (window as unknown as { Plotly: ReturnType<typeof mockPlotly> }).Plotly = mockPlotly();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ShareOutCharts', () => {
  it('uses existing Plotly on window without injecting a script tag', async () => {
    const charts = new ShareOutCharts({ theme: 'dark' });
    const appendSpy = vi.spyOn(document.head, 'appendChild');

    await charts.create('chart-host', baseConfig());

    expect(appendSpy).not.toHaveBeenCalled();
    expect(window.Plotly.newPlot).toHaveBeenCalledTimes(1);
  });

  it('creates, updates, and reads chart config from the DOM', async () => {
    const charts = new ShareOutCharts();
    await charts.create('chart-host', baseConfig());

    const element = document.getElementById('chart-host')!;
    expect(element.getAttribute('data-chart-id')).toBe('chart-1');
    expect(ShareOutCharts.parseFromElement(element)?.title).toBe('Revenue');

    await charts.setTitle('chart-1', 'Updated');
    await charts.setType('chart-1', 'bar');
    await charts.setColors('chart-1', ['#111111', '#222222']);
    await charts.updateData('chart-1', [{ name: 'Q2', data: [5, 15, 25] }]);

    expect(charts.getConfig('chart-1')?.title).toBe('Updated');
    expect(charts.getConfig('chart-1')?.type).toBe('bar');
    expect(window.Plotly.react).toHaveBeenCalled();
  });

  it('supports additional chart types and layout options', async () => {
    const charts = new ShareOutCharts({ theme: 'light' });
    const configs: ChartConfig[] = [
      baseConfig({ id: 'pie', type: 'pie', series: [{ name: 'Share', data: [{ x: 'A', y: 30 }, { x: 'B', y: 70 }] }] }),
      baseConfig({ id: 'donut', type: 'donut', series: [{ name: 'Share', data: [{ x: 'A', y: 40 }, { x: 'B', y: 60 }] }] }),
      baseConfig({ id: 'scatter', type: 'scatter', series: [{ name: 'Pts', data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }] }),
      baseConfig({ id: 'area', type: 'area', series: [{ name: 'Area', data: [1, 2, 3] }] }),
      baseConfig({ id: 'gauge', type: 'gauge', series: [{ name: 'Score', data: [82] }] }),
      baseConfig({
        id: 'heatmap',
        type: 'heatmap',
        series: [{ name: 'Heat', data: [{ x: 'a', y: 1 }, { x: 'b', y: 2 }] }],
      }),
      baseConfig({ id: 'funnel', type: 'funnel', series: [{ name: 'Funnel', data: [100, 60, 30] }] }),
    ];

    for (const config of configs) {
      document.body.innerHTML = `<div id="${config.id}"></div>`;
      await charts.create(config.id, config);
    }

    expect(window.Plotly.newPlot).toHaveBeenCalledTimes(configs.length);
  });

  it('throws when container is missing and returns null for invalid DOM config', async () => {
    const charts = new ShareOutCharts();
    await expect(charts.create('missing', baseConfig())).rejects.toThrow('Chart container not found');

    const bad = document.createElement('div');
    bad.setAttribute('data-shareout-chart', '{not-json');
    expect(ShareOutCharts.parseFromElement(bad)).toBeNull();
  });

  it('destroys charts and clears auto-refresh timers', async () => {
    vi.useFakeTimers();
    const charts = new ShareOutCharts();
    await charts.create('chart-host', baseConfig({
      dataBinding: { source: 'api', apiUrl: 'https://example.com/data', refreshInterval: 1000 },
    }));

    await charts.destroy('chart-1');
    expect(window.Plotly.purge).toHaveBeenCalledTimes(1);
    expect(charts.getConfig('chart-1')).toBeNull();

    document.body.innerHTML = '<div id="chart-host"></div><div id="chart-2"></div>';
    await charts.create('chart-host', baseConfig({ id: 'chart-a' }));
    await charts.create('chart-2', baseConfig({ id: 'chart-b' }));
    await charts.destroyAll();
    expect(window.Plotly.purge).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('exposes chart templates with expected defaults', () => {
    expect(ShareOutCharts.templates.line('line-1', 'Line').type).toBe('line');
    expect(ShareOutCharts.templates.bar('bar-1').series).toHaveLength(2);
    expect(ShareOutCharts.templates.pie('pie-1').legendPosition).toBe('right');
    expect(ShareOutCharts.templates.gauge('gauge-1', 'Progress', 90).series[0].data).toEqual([90]);
    expect(ShareOutCharts.templates.kpi('kpi-1', 'Users', 1200).height).toBe(150);
  });

  it('loads Plotly from CDN when it is not already present', async () => {
    delete (window as unknown as { Plotly?: unknown }).Plotly;
    const script = document.createElement('script');
    vi.spyOn(document, 'createElement').mockReturnValue(script);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      (window as unknown as { Plotly: ReturnType<typeof mockPlotly> }).Plotly = mockPlotly();
      script.onload?.(new Event('load'));
      return node;
    });

    const charts = new ShareOutCharts({ plotlyCDN: 'https://cdn.example/plotly.js' });
    await charts.create('chart-host', baseConfig());

    expect(document.createElement).toHaveBeenCalledWith('script');
    expect(window.Plotly.newPlot).toHaveBeenCalledTimes(1);
  });

  it('refreshes chart data from an API binding on interval', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [
        { region: 'US', total: 10 },
        { region: 'EU', total: 20 },
      ],
    })));

    const charts = new ShareOutCharts();
    await charts.create('chart-host', baseConfig({
      dataBinding: {
        source: 'api',
        apiUrl: 'https://example.com/metrics',
        xColumn: 'region',
        yColumns: ['total'],
        refreshInterval: 1000,
      },
    }));

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledWith('https://example.com/metrics');
    expect(window.Plotly.react).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('aggregates grouped table data when groupBy is configured', async () => {
    vi.useFakeTimers();
    (window as unknown as {
      ShareOut?: {
        table: (name: string) => { list: () => Promise<unknown[]> };
      };
    }).ShareOut = {
      table: () => ({
        list: async () => [
          { team: 'A', score: 10 },
          { team: 'A', score: 20 },
          { team: 'B', score: 5 },
        ],
      }),
    };

    const charts = new ShareOutCharts();
    await charts.create('chart-host', baseConfig({
      dataBinding: {
        source: 'table',
        tableName: 'scores',
        groupBy: 'team',
        aggregation: 'sum',
        refreshInterval: 500,
      },
    }));

    await vi.advanceTimersByTimeAsync(500);
    expect(window.Plotly.react).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('uses dark theme layout when theme is auto and prefers dark', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const charts = new ShareOutCharts({ theme: 'auto' });
    await charts.create('chart-host', baseConfig({ title: 'Dark chart' }));
    expect(window.Plotly.newPlot).toHaveBeenCalled();
    const layout = (window.Plotly.newPlot as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(layout).toMatchObject({ paper_bgcolor: '#1f2937' });
  });

  it('refreshes chart data from json bindings', async () => {
    vi.useFakeTimers();
    (window as unknown as {
      ShareOut?: { json: { get: (key: string) => Promise<unknown> } };
    }).ShareOut = {
      json: {
        get: async () => [
          { region: 'US', total: 10 },
          { region: 'EU', total: 20 },
        ],
      },
    };

    const charts = new ShareOutCharts();
    await charts.create('chart-host', baseConfig({
      dataBinding: {
        source: 'json',
        jsonKey: 'metrics',
        xColumn: 'region',
        yColumns: ['total'],
        refreshInterval: 500,
      },
    }));

    await vi.advanceTimersByTimeAsync(500);
    expect(window.Plotly.react).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('throws when updating a missing chart', async () => {
    const charts = new ShareOutCharts();
    await expect(charts.update('missing', { title: 'Nope' })).rejects.toThrow('Chart not found');
  });

  it('aggregates with count, min, and max strategies', async () => {
    vi.useFakeTimers();
    const rows = [
      { team: 'A', score: 10 },
      { team: 'A', score: 30 },
      { team: 'B', score: 5 },
    ];

    for (const aggregation of ['count', 'min', 'max', 'avg'] as const) {
      (window as unknown as {
        ShareOut?: { table: (name: string) => { list: () => Promise<unknown[]> } };
      }).ShareOut = {
        table: () => ({ list: async () => rows }),
      };

      document.body.innerHTML = '<div id="chart-host"></div>';
      const charts = new ShareOutCharts();
      await charts.create('chart-host', baseConfig({
        id: `chart-${aggregation}`,
        dataBinding: {
          source: 'table',
          tableName: 'scores',
          groupBy: 'team',
          aggregation,
          refreshInterval: 100,
        },
      }));
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(window.Plotly.react).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
