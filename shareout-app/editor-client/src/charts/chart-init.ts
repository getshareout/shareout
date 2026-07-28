import type { EditorContext } from '../editor/context';
import { parseChartConfig } from './chart-data-model';

interface ChartsSdk {
  create(container: Element, config: unknown): Promise<void>;
}

export async function initDroppedCharts(ctx: EditorContext, doc: Document) {
  if (!doc) {
    console.warn('[chart-init] initDroppedCharts: doc is null');
    return;
  }

  // Find all chart containers that haven't been initialized
  const chartContainers = doc.querySelectorAll('[data-shareout-chart]:not(.chart-initialized)');
  if (chartContainers.length === 0) return;

  // Load ShareOutCharts SDK if not already loaded
  if (!window.ShareOutCharts) {
    if (!doc.head) {
      console.warn('[chart-init] initDroppedCharts: doc.head is null, cannot load charts SDK');
      return;
    }
    const script = doc.createElement('script');
    script.src = '/sdk/shareout-charts.js';
    script.onload = () => initializeCharts(ctx, doc, chartContainers);
    doc.head.appendChild(script);
  } else {
    initializeCharts(ctx, doc, chartContainers);
  }
}

export async function initializeCharts(
  ctx: EditorContext,
  doc: Document,
  containers: NodeListOf<Element>,
) {
  const g = window.ShareOutCharts;
  if (!g) return;

  const obj = g as { default?: new () => ChartsSdk; ShareOutCharts?: new () => ChartsSdk } | undefined;
  const ChartsClass: (new () => ChartsSdk) | undefined =
    typeof g === 'function' ? (g as new () => ChartsSdk) : obj?.default ?? obj?.ShareOutCharts;
  if (!ChartsClass) return;

  const charts = new ChartsClass();
  for (const container of containers) {
    try {
      const config = parseChartConfig(container);
      if (!Object.keys(config).length) continue;

      // F15: render with the chart's own parsed config — not ctx.config (slug/artifactId).
      await charts.create(container, config);
      container.classList.add('chart-initialized');
    } catch (err) {
      console.error('Failed to init chart:', err);
    }
  }
}
