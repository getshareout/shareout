// ShareOut Charts SDK - Plotly Wrapper
// Provides a simple, editor-friendly API for charts in ShareOut artifacts

export type ChartType = 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'donut' | 'heatmap' | 'gauge' | 'funnel';

export interface ChartDataPoint {
  x: string | number | Date;
  y: number;
  label?: string;
  color?: string;
}

export interface ChartSeries {
  name: string;
  data: ChartDataPoint[] | number[];
  color?: string;
  type?: ChartType;
}

export interface ChartDataBinding {
  source: 'manual' | 'table' | 'json' | 'api' | 'sheets';
  tableName?: string;
  jsonKey?: string;
  apiUrl?: string;
  xColumn?: string;
  yColumns?: string[];
  aggregation?: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'none';
  groupBy?: string;
  refreshInterval?: number;
  spreadsheetId?: string;
  range?: string;
}

export interface ChartConfig {
  id: string;
  type: ChartType;
  title?: string;
  subtitle?: string;
  series: ChartSeries[];
  categories?: string[];
  colors?: string[];
  showLegend?: boolean;
  legendPosition?: 'top' | 'bottom' | 'left' | 'right';
  showGrid?: boolean;
  showAxes?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  stacked?: boolean;
  animation?: {
    enabled: boolean;
    duration: number;
    easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  };
  responsive?: boolean;
  height?: number | string;
  width?: number | string;
  dataBinding?: ChartDataBinding;
  _version?: number;
}

export interface ShareOutChartsOptions {
  plotlyCDN?: string;
  theme?: 'light' | 'dark' | 'auto';
  defaultColors?: string[];
  animationDuration?: number;
}

// Plotly types (loaded from CDN at runtime)
interface PlotlyInstance {
  newPlot: (el: HTMLElement, data: unknown[], layout?: unknown, config?: unknown) => Promise<void>;
  react: (el: HTMLElement, data: unknown[], layout?: unknown) => Promise<void>;
  purge: (el: HTMLElement) => void;
}

const DEFAULT_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
];

const DEFAULT_PLOTLY_CDN = 'https://cdn.plot.ly/plotly-2.27.0.min.js';

class ShareOutCharts {
  private charts = new Map<string, { config: ChartConfig; plotly: unknown }>();
  private plotlyLoaded = false;
  private plotlyPromise: Promise<void> | null = null;
  private options: ShareOutChartsOptions;
  private refreshTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(options: ShareOutChartsOptions = {}) {
    this.options = {
      plotlyCDN: options.plotlyCDN || DEFAULT_PLOTLY_CDN,
      theme: options.theme || 'light',
      defaultColors: options.defaultColors || DEFAULT_COLORS,
      animationDuration: options.animationDuration || 500,
    };
  }

  private async loadPlotly(): Promise<void> {
    if (this.plotlyLoaded) return;
    if (this.plotlyPromise) return this.plotlyPromise;

    this.plotlyPromise = new Promise((resolve, reject) => {
      if (typeof window !== 'undefined' && (window as unknown as { Plotly: PlotlyInstance }).Plotly) {
        this.plotlyLoaded = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = this.options.plotlyCDN!;
      script.async = true;
      script.onload = () => {
        this.plotlyLoaded = true;
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load Plotly'));
      document.head.appendChild(script);
    });

    return this.plotlyPromise;
  }

  private getPlotly(): PlotlyInstance {
    return (window as unknown as { Plotly: PlotlyInstance }).Plotly;
  }

  private configToPlotlyData(config: ChartConfig): unknown[] {
    const colors = config.colors || this.options.defaultColors!;

    return config.series.map((series, idx) => {
      const plotlyType = this.mapChartType(config.type, series.type);
      const color = series.color || colors[idx % colors.length];

      const x = config.categories || series.data.map((d, i) =>
        typeof d === 'object' ? (d as ChartDataPoint).x : i
      );
      const y = series.data.map(d =>
        typeof d === 'object' ? (d as ChartDataPoint).y : d
      );

      const baseTrace = {
        name: series.name,
        x: x as (string | number)[],
        y: y,
        marker: { color },
      };

      switch (plotlyType) {
        case 'scatter':
          return { ...baseTrace, type: 'scatter', mode: 'markers' };
        case 'line':
          return { ...baseTrace, type: 'scatter', mode: 'lines' };
        case 'area':
          return { ...baseTrace, type: 'scatter', mode: 'lines', fill: 'tozeroy' };
        case 'bar':
          return { ...baseTrace, type: 'bar' };
        case 'pie':
        case 'donut':
          return {
            name: series.name,
            labels: x,
            values: y,
            type: 'pie',
            hole: plotlyType === 'donut' ? 0.4 : 0,
            marker: { colors: colors.slice(0, y.length) },
          };
        case 'heatmap':
          return {
            ...baseTrace,
            type: 'heatmap',
            z: series.data.map(d => [typeof d === 'object' ? (d as ChartDataPoint).y : d]),
          };
        case 'funnel':
          return {
            ...baseTrace,
            type: 'funnel',
          };
        case 'gauge':
          return {
            type: 'indicator',
            mode: 'gauge+number',
            value: y[0] || 0,
            title: { text: series.name },
            gauge: {
              axis: { range: [0, Math.max(...(y as number[])) * 1.2] },
              bar: { color },
            },
          };
        default:
          return baseTrace;
      }
    });
  }

  private mapChartType(primaryType: ChartType, seriesType?: ChartType): string {
    return seriesType || primaryType;
  }

  private configToPlotlyLayout(config: ChartConfig): unknown {
    const isDark = this.options.theme === 'dark' ||
      (this.options.theme === 'auto' &&
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);

    return {
      title: config.title ? { text: config.title } : undefined,
      showlegend: config.showLegend !== false,
      legend: config.legendPosition ? {
        orientation: config.legendPosition === 'top' || config.legendPosition === 'bottom' ? 'h' : 'v',
        x: config.legendPosition === 'left' ? 0 : config.legendPosition === 'right' ? 1 : 0.5,
        y: config.legendPosition === 'top' ? 1.1 : config.legendPosition === 'bottom' ? -0.1 : 0.5,
        xanchor: 'center',
      } : undefined,
      xaxis: {
        title: config.xAxisLabel,
        showgrid: config.showGrid !== false,
        visible: config.showAxes !== false,
      },
      yaxis: {
        title: config.yAxisLabel,
        showgrid: config.showGrid !== false,
        visible: config.showAxes !== false,
      },
      paper_bgcolor: isDark ? '#1f2937' : 'white',
      plot_bgcolor: isDark ? '#111827' : 'white',
      font: {
        color: isDark ? '#f3f4f6' : '#1f2937',
      },
      margin: { t: config.title ? 50 : 30, r: 30, b: 50, l: 50 },
      barmode: config.stacked ? 'stack' : undefined,
      height: typeof config.height === 'number' ? config.height : undefined,
      width: typeof config.width === 'number' ? config.width : undefined,
    };
  }

  private configToPlotlyConfig(config: ChartConfig): unknown {
    return {
      responsive: config.responsive !== false,
      displayModeBar: false,
      staticPlot: false,
    };
  }

  async create(elementOrId: string | HTMLElement, config: ChartConfig): Promise<void> {
    await this.loadPlotly();

    const element = typeof elementOrId === 'string'
      ? document.getElementById(elementOrId)
      : elementOrId;

    if (!element) {
      throw new Error(`Chart container not found: ${elementOrId}`);
    }

    config._version = 1;
    element.setAttribute('data-shareout-chart', JSON.stringify(config));
    element.setAttribute('data-chart-id', config.id);

    const Plotly = this.getPlotly();
    const data = this.configToPlotlyData(config);
    const layout = this.configToPlotlyLayout(config);
    const plotlyConfig = this.configToPlotlyConfig(config);

    await Plotly.newPlot(element, data, layout, plotlyConfig);

    this.charts.set(config.id, { config, plotly: element });

    if (config.dataBinding?.refreshInterval) {
      this.startAutoRefresh(config.id, config.dataBinding.refreshInterval);
    }
  }

  async update(chartId: string, updates: Partial<ChartConfig>): Promise<void> {
    const chart = this.charts.get(chartId);
    if (!chart) {
      throw new Error(`Chart not found: ${chartId}`);
    }

    const newConfig = { ...chart.config, ...updates, _version: (chart.config._version || 0) + 1 };
    const element = chart.plotly as HTMLElement;

    element.setAttribute('data-shareout-chart', JSON.stringify(newConfig));

    const Plotly = this.getPlotly();
    const data = this.configToPlotlyData(newConfig);
    const layout = this.configToPlotlyLayout(newConfig);

    await Plotly.react(element, data, layout);

    this.charts.set(chartId, { config: newConfig, plotly: element });
  }

  async updateData(chartId: string, series: ChartSeries[]): Promise<void> {
    return this.update(chartId, { series });
  }

  async setTitle(chartId: string, title: string): Promise<void> {
    return this.update(chartId, { title });
  }

  async setType(chartId: string, type: ChartType): Promise<void> {
    return this.update(chartId, { type });
  }

  async setColors(chartId: string, colors: string[]): Promise<void> {
    return this.update(chartId, { colors });
  }

  getConfig(chartId: string): ChartConfig | null {
    return this.charts.get(chartId)?.config || null;
  }

  static parseFromElement(element: HTMLElement): ChartConfig | null {
    const configStr = element.getAttribute('data-shareout-chart');
    if (!configStr) return null;
    try {
      return JSON.parse(configStr);
    } catch {
      return null;
    }
  }

  async destroy(chartId: string): Promise<void> {
    const chart = this.charts.get(chartId);
    if (!chart) return;

    this.stopAutoRefresh(chartId);

    const Plotly = this.getPlotly();
    Plotly.purge(chart.plotly as HTMLElement);

    this.charts.delete(chartId);
  }

  async destroyAll(): Promise<void> {
    for (const chartId of this.charts.keys()) {
      await this.destroy(chartId);
    }
  }

  private startAutoRefresh(chartId: string, intervalMs: number): void {
    this.stopAutoRefresh(chartId);
    const timer = setInterval(() => this.refreshData(chartId), intervalMs);
    this.refreshTimers.set(chartId, timer);
  }

  private stopAutoRefresh(chartId: string): void {
    const timer = this.refreshTimers.get(chartId);
    if (timer) {
      clearInterval(timer);
      this.refreshTimers.delete(chartId);
    }
  }

  private async refreshData(chartId: string): Promise<void> {
    const chart = this.charts.get(chartId);
    if (!chart?.config.dataBinding) return;

    const binding = chart.config.dataBinding;
    let newData: ChartSeries[] | null = null;

    try {
      switch (binding.source) {
        case 'api':
          if (binding.apiUrl) {
            const res = await fetch(binding.apiUrl);
            const json = await res.json();
            newData = this.transformApiData(json, binding);
          }
          break;
        case 'table':
          if (typeof window !== 'undefined') {
            const sdk = (window as unknown as { ShareOut?: { table: (name: string) => { list: () => Promise<unknown[]> } } }).ShareOut;
            if (sdk && binding.tableName) {
              const rows = await sdk.table(binding.tableName).list();
              newData = this.transformTableData(rows as Record<string, unknown>[], binding);
            }
          }
          break;
        case 'json':
          if (typeof window !== 'undefined') {
            const sdk = (window as unknown as { ShareOut?: { json: { get: (key: string) => Promise<unknown> } } }).ShareOut;
            if (sdk && binding.jsonKey) {
              const data = await sdk.json.get(binding.jsonKey);
              newData = this.transformJsonData(data, binding);
            }
          }
          break;
      }

      if (newData) {
        await this.updateData(chartId, newData);
      }
    } catch (err) {
      console.error(`ShareOut Charts: Failed to refresh ${chartId}:`, err);
    }
  }

  private transformApiData(data: unknown, binding: ChartDataBinding): ChartSeries[] {
    const items = Array.isArray(data) ? data : [data];
    return this.transformTableData(items as Record<string, unknown>[], binding);
  }

  private transformTableData(rows: Record<string, unknown>[], binding: ChartDataBinding): ChartSeries[] {
    const xCol = binding.xColumn || 'x';
    const yCols = binding.yColumns || ['y'];

    if (binding.groupBy && binding.aggregation && binding.aggregation !== 'none') {
      const groups = new Map<string, number[]>();
      for (const row of rows) {
        const key = String(row[binding.groupBy] || 'Unknown');
        if (!groups.has(key)) groups.set(key, []);
        for (const yCol of yCols) {
          groups.get(key)!.push(Number(row[yCol]) || 0);
        }
      }

      const aggregated = new Map<string, number>();
      for (const [key, values] of groups) {
        switch (binding.aggregation) {
          case 'count':
            aggregated.set(key, values.length);
            break;
          case 'sum':
            aggregated.set(key, values.reduce((a, b) => a + b, 0));
            break;
          case 'avg':
            aggregated.set(key, values.reduce((a, b) => a + b, 0) / values.length);
            break;
          case 'min':
            aggregated.set(key, Math.min(...values));
            break;
          case 'max':
            aggregated.set(key, Math.max(...values));
            break;
        }
      }

      return [{
        name: binding.groupBy,
        data: Array.from(aggregated.entries()).map(([x, y]) => ({ x, y })),
      }];
    }

    return yCols.map(yCol => ({
      name: yCol,
      data: rows.map(row => ({
        x: row[xCol] as string | number,
        y: Number(row[yCol]) || 0,
      })),
    }));
  }

  private transformJsonData(data: unknown, binding: ChartDataBinding): ChartSeries[] {
    if (Array.isArray(data)) {
      return this.transformTableData(data as Record<string, unknown>[], binding);
    }
    return [{ name: 'Value', data: [data as number] }];
  }

  static templates = {
    line: (id: string, title?: string): ChartConfig => ({
      id,
      type: 'line',
      title,
      series: [
        { name: 'Series 1', data: [10, 20, 30, 40, 50] },
      ],
      categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
      showLegend: true,
      showGrid: true,
      responsive: true,
    }),

    bar: (id: string, title?: string): ChartConfig => ({
      id,
      type: 'bar',
      title,
      series: [
        { name: 'Category A', data: [30, 45, 25, 60, 35] },
        { name: 'Category B', data: [20, 35, 40, 30, 45] },
      ],
      categories: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
      showLegend: true,
      responsive: true,
    }),

    pie: (id: string, title?: string): ChartConfig => ({
      id,
      type: 'pie',
      title,
      series: [
        { name: 'Distribution', data: [
          { x: 'Category A', y: 30 },
          { x: 'Category B', y: 25 },
          { x: 'Category C', y: 20 },
          { x: 'Category D', y: 15 },
          { x: 'Category E', y: 10 },
        ]},
      ],
      showLegend: true,
      legendPosition: 'right',
      responsive: true,
    }),

    area: (id: string, title?: string): ChartConfig => ({
      id,
      type: 'area',
      title,
      series: [
        { name: 'Traffic', data: [100, 200, 150, 300, 250, 400] },
      ],
      categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      showLegend: true,
      showGrid: true,
      responsive: true,
    }),

    scatter: (id: string, title?: string): ChartConfig => ({
      id,
      type: 'scatter',
      title,
      series: [
        { name: 'Dataset', data: [
          { x: 1, y: 10 }, { x: 2, y: 15 }, { x: 3, y: 8 },
          { x: 4, y: 22 }, { x: 5, y: 18 }, { x: 6, y: 25 },
        ]},
      ],
      showLegend: false,
      showGrid: true,
      responsive: true,
    }),

    donut: (id: string, title?: string): ChartConfig => ({
      id,
      type: 'donut',
      title,
      series: [
        { name: 'Distribution', data: [
          { x: 'Complete', y: 65 },
          { x: 'In Progress', y: 25 },
          { x: 'Pending', y: 10 },
        ]},
      ],
      showLegend: true,
      legendPosition: 'bottom',
      responsive: true,
    }),

    gauge: (id: string, title?: string, value = 75): ChartConfig => ({
      id,
      type: 'gauge',
      title,
      series: [{ name: title || 'Progress', data: [value] }],
      responsive: true,
    }),

    kpi: (id: string, title: string, value: number): ChartConfig => ({
      id,
      type: 'gauge',
      title,
      series: [{ name: title, data: [value] }],
      responsive: true,
      height: 150,
    }),
  };
}

export { ShareOutCharts };
export default ShareOutCharts;

if (typeof window !== 'undefined') {
  (window as unknown as { ShareOutCharts: typeof ShareOutCharts }).ShareOutCharts = ShareOutCharts;
}
