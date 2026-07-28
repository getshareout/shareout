// @ts-nocheck
/**
 * Chart Editor v2.0
 *
 * Supports the new ShareOut chart attributes:
 * - data-shareout-chart: Chart config (type, title, colors, legend)
 * - data-shareout-chart-data: Data source binding (table:name or json:key)
 * - data-shareout-chart-x: X-axis column/key
 * - data-shareout-chart-y: Y-axis column(s), comma-separated
 * - data-shareout-chart-filter: Filter expression
 */
import type { EditorContext } from '../editor/context';
import { CHART_ATTR } from '../sdk-patterns';
import {
  getChartDataBinding,
  setChartDataBinding,
  parseChartConfig,
  writeChartConfig,
  migrateLegacyDataBinding,
} from './chart-data-model';
import { escapeHtml, rgbToHex } from '../utils';
import { showToast } from '../toast';
import { getElementSelector as buildElementSelector } from '../dom/element-selector';
import { renderCanvas } from '../canvas/render-canvas';
import { renderSelectionHandles } from '../canvas/selection';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { markDirty } from '../persistence/draft';
import { pushUndo } from '../history/undo-redo';

export type { ChartDataBinding } from './chart-data-model';
export { getChartDataBinding, setChartDataBinding } from './chart-data-model';

export function detectAndRenderChartEditor(ctx: EditorContext, element) {
  // Look for data-shareout-chart attribute (our chart SDK)
  if (!element.getAttribute(CHART_ATTR)) return;

  let config = parseChartConfig(element);
  if (!Object.keys(config).length) return;

  // F14: collapse any legacy config.dataBinding (model B) onto the flat attrs (model A) so the
  // two representations stop conflicting; persist the cleaned config only if we changed it.
  const migration = migrateLegacyDataBinding(config, element);
  config = migration.config;
  if (migration.migrated) {
    writeChartConfig(element, config);
    markDirty(ctx);
    syncHtmlFromCanvas(ctx);
  }

  // Get current data binding from attributes
  const dataBinding = getChartDataBinding(element);
  const hasDataBinding = !!dataBinding.source;

  // Get available data sources from manifest
  const manifest = ctx.state.manifest;
  const tableOptions = manifest?.tableNames || [];
  const jsonOptions = manifest?.jsonKeys || [];

  // Add Chart editor section
  const chartSection = document.createElement('div');
  chartSection.className = 'property-group chart-editor';
  chartSection.innerHTML = `
    <div class="property-group-title">Chart Editor</div>
    <div class="chart-type-selector">
      <label class="property-label">Type</label>
      <select class="property-input chart-type-select">
        <option value="line" ${config.type === 'line' ? 'selected' : ''}>Line</option>
        <option value="bar" ${config.type === 'bar' ? 'selected' : ''}>Bar</option>
        <option value="pie" ${config.type === 'pie' ? 'selected' : ''}>Pie</option>
        <option value="area" ${config.type === 'area' ? 'selected' : ''}>Area</option>
        <option value="scatter" ${config.type === 'scatter' ? 'selected' : ''}>Scatter</option>
        <option value="donut" ${config.type === 'donut' ? 'selected' : ''}>Donut</option>
        <option value="gauge" ${config.type === 'gauge' ? 'selected' : ''}>Gauge</option>
      </select>
    </div>
    <div class="property-row">
      <label class="property-label">Title</label>
      <input class="property-input chart-title-input" value="${escapeHtml(config.title || '')}">
    </div>
    <div class="chart-appearance">
      <div class="property-row">
        <label class="property-label">Legend</label>
        <input type="checkbox" class="chart-legend-toggle" ${config.showLegend !== false ? 'checked' : ''}>
      </div>
      <div class="property-row">
        <label class="property-label">Grid</label>
        <input type="checkbox" class="chart-grid-toggle" ${config.showGrid !== false ? 'checked' : ''}>
      </div>
    </div>
    <div class="chart-data-section">
      <div class="property-group-title" style="margin-top:12px">Data Binding</div>
      <div class="property-row">
        <label class="property-label">Source</label>
        <select class="property-input chart-data-source-select">
          <option value="">Manual data</option>
          ${tableOptions.map(t => `<option value="table:${t}" ${dataBinding.source === 'table:' + t ? 'selected' : ''}>Table: ${t}</option>`).join('')}
          ${jsonOptions.map(j => `<option value="json:${j}" ${dataBinding.source === 'json:' + j ? 'selected' : ''}>JSON: ${j}</option>`).join('')}
        </select>
      </div>
      <div class="chart-binding-fields${hasDataBinding ? '' : ' is-hidden'}">
        <div class="property-row">
          <label class="property-label">X Axis</label>
          <input class="property-input chart-x-input" value="${escapeHtml(dataBinding.x || '')}" placeholder="column name">
        </div>
        <div class="property-row">
          <label class="property-label">Y Axis</label>
          <input class="property-input chart-y-input" value="${escapeHtml(dataBinding.y.join(', '))}" placeholder="col1, col2">
        </div>
        <div class="property-row">
          <label class="property-label">Filter</label>
          <input class="property-input chart-filter-input" value="${escapeHtml(dataBinding.filter || '')}" placeholder="status=active">
        </div>
      </div>
      <button type="button" class="sdk-editor-btn chart-data-btn${hasDataBinding ? ' is-hidden' : ''}">
        <span class="sdk-icon">[C]</span>
        <span>Edit Manual Data</span>
      </button>
    </div>
    <div class="chart-colors-section">
      <div class="property-group-title" style="margin-top:12px">Colors</div>
      <div class="chart-color-palette">
        ${(config.colors || ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6']).slice(0,5).map((c, i) =>
          `<input type="color" class="color-swatch chart-color-${i}" value="${c}" data-idx="${i}">`
        ).join('')}
      </div>
    </div>
  `;

  // Bind chart editor events
  const chartId = config.id;
  const bindingFields = chartSection.querySelector('.chart-binding-fields');
  const dataBtn = chartSection.querySelector('.chart-data-btn');

  chartSection.querySelector('.chart-type-select').addEventListener('change', (e) => {
    updateChartConfig(ctx, element, chartId, { type: e.target.value });
  });

  chartSection.querySelector('.chart-title-input').addEventListener('change', (e) => {
    updateChartConfig(ctx, element, chartId, { title: e.target.value });
  });

  chartSection.querySelector('.chart-legend-toggle').addEventListener('change', (e) => {
    updateChartConfig(ctx, element, chartId, { showLegend: e.target.checked });
  });

  chartSection.querySelector('.chart-grid-toggle').addEventListener('change', (e) => {
    updateChartConfig(ctx, element, chartId, { showGrid: e.target.checked });
  });

  // Data source binding (flat attrs — the single source-binding model). Each edit is undoable,
  // marks the draft dirty, and re-renders the chart via the SDK from the element's new attrs.
  const commitBinding = () => {
    markDirty(ctx);
    syncHtmlFromCanvas(ctx);
    rerenderChartFromElement(element, config);
  };

  chartSection.querySelector('.chart-data-source-select').addEventListener('change', (e) => {
    pushUndo(ctx.state);
    const source = e.target.value;
    setChartDataBinding(element, { source: source || null });
    bindingFields?.classList.toggle('is-hidden', !!source);
    dataBtn?.classList.toggle('is-hidden', !!source);
    commitBinding();
  });

  chartSection.querySelector('.chart-x-input')?.addEventListener('change', (e) => {
    pushUndo(ctx.state);
    setChartDataBinding(element, { x: e.target.value || null });
    commitBinding();
  });

  chartSection.querySelector('.chart-y-input')?.addEventListener('change', (e) => {
    pushUndo(ctx.state);
    const yValues = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    setChartDataBinding(element, { y: yValues });
    commitBinding();
  });

  chartSection.querySelector('.chart-filter-input')?.addEventListener('change', (e) => {
    pushUndo(ctx.state);
    setChartDataBinding(element, { filter: e.target.value || null });
    commitBinding();
  });

  chartSection.querySelector('.chart-data-btn')?.addEventListener('click', () => {
    openChartDataEditor(ctx, element, config);
  });

  chartSection.querySelectorAll('.chart-color-palette input').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const currentColors = config.colors || ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6'];
      currentColors[idx] = e.target.value;
      updateChartConfig(ctx, element, chartId, { colors: currentColors });
    });
  });

  ctx.dom.propertyPanel?.appendChild(chartSection);
}

export async function updateChartConfig(ctx: EditorContext, element, chartId, updates) {
  pushUndo(ctx.state);
  const currentConfig = parseChartConfig(element);
  const newConfig = { ...currentConfig, ...updates, _version: (currentConfig._version || 0) + 1 };
  writeChartConfig(element, newConfig);

  // Update chart via SDK
  if (window.ShareOutCharts) {
    const ChartsClass = window.ShareOutCharts?.default || window.ShareOutCharts?.ShareOutCharts || window.ShareOutCharts;
    if (ChartsClass && typeof ChartsClass === 'function') {
      const charts = new ChartsClass();
      try {
        await charts.update(chartId, updates);
      } catch (e) {
        // Re-create chart if update fails
        await charts.create(element, newConfig);
      }
    }
  }

  markDirty(ctx);
  syncHtmlFromCanvas(ctx);
}

/** Re-render a chart from its element (config JSON + flat data attrs) via the SDK, mirroring
 *  chart-init's create(container, config). Used after a data-binding edit so the canvas updates. */
async function rerenderChartFromElement(element, config) {
  if (!window.ShareOutCharts) return;
  const ChartsClass = window.ShareOutCharts?.default || window.ShareOutCharts?.ShareOutCharts || window.ShareOutCharts;
  if (!ChartsClass || typeof ChartsClass !== 'function') return;
  try {
    await new ChartsClass().create(element, config);
  } catch (e) {
    console.error('[chart-editor] re-render failed:', e);
  }
}

export function openChartDataEditor(ctx: EditorContext, element, config) {
  // Manual data only. Table/JSON/API source binding lives in the inline editor's flat attrs
  // (model A); this modal edits hand-entered series + categories in the config JSON. The old
  // per-modal source picker (model B) is gone — it conflicted with the flat attrs (F14).
  const modal = document.createElement('div');
  modal.className = 'sdk-modal';
  const hideCategories = config.type === 'pie' || config.type === 'donut';
  modal.innerHTML = `
    <div class="sdk-modal-overlay"></div>
    <div class="sdk-modal-content" style="max-width:700px">
      <div class="sdk-modal-header">
        <span>Manual Chart Data</span>
        <button class="sdk-modal-close">&times;</button>
      </div>
      <div class="sdk-modal-body">
        <div class="chart-data-editor">
          <p class="bound-note">To bind a table or JSON source instead, use the chart's Source dropdown in Inspect.</p>
          <div class="chart-manual-data">
            <div class="property-group-title" style="margin:12px 0 8px">Series Data</div>
            <div class="chart-series-list">
              ${(config.series || []).map((series, idx) => `
                <div class="chart-series-item" data-idx="${idx}">
                  <div class="property-row">
                    <label class="property-label">Name</label>
                    <input class="property-input series-name" value="${escapeHtml(series.name)}">
                  </div>
                  <div class="property-row">
                    <label class="property-label">Data</label>
                    <textarea class="property-input series-data" rows="2">${escapeHtml(JSON.stringify(series.data))}</textarea>
                  </div>
                </div>
              `).join('')}
            </div>
            <button type="button" class="so-c-btn so-c-btn--secondary so-c-btn--sm chart-add-series-btn" id="add-series-btn">+ Add Series</button>
          </div>
          <div class="chart-categories${hideCategories ? ' is-hidden' : ''}">
            <label class="property-label">Categories (comma separated)</label>
            <input class="property-input" id="chart-categories" value="${escapeHtml((config.categories || []).join(', '))}" style="width:100%">
          </div>
        </div>
      </div>
      <div class="sdk-modal-footer">
        <button class="so-c-btn so-c-btn--primary" id="save-chart-data">Save Changes</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#add-series-btn').addEventListener('click', () => {
    const seriesList = modal.querySelector('.chart-series-list');
    const idx = seriesList.children.length;
    const newSeries = document.createElement('div');
    newSeries.className = 'chart-series-item';
    newSeries.dataset.idx = idx;
    newSeries.innerHTML = `
      <div class="property-row">
        <label class="property-label">Name</label>
        <input class="property-input series-name" value="Series ${idx + 1}">
      </div>
      <div class="property-row">
        <label class="property-label">Data</label>
        <textarea class="property-input series-data" rows="2">[10, 20, 30, 40, 50]</textarea>
      </div>
    `;
    seriesList.appendChild(newSeries);
  });

  modal.querySelector('#save-chart-data').addEventListener('click', () => {
    const updates: Record<string, any> = {};
    const series = [];
    modal.querySelectorAll('.chart-series-item').forEach((item) => {
      const name = item.querySelector('.series-name').value;
      let data;
      try {
        data = JSON.parse(item.querySelector('.series-data').value);
      } catch {
        data = [0];
      }
      series.push({ name, data });
    });
    updates.series = series;

    const categoriesInput = modal.querySelector('#chart-categories').value;
    updates.categories = categoriesInput
      ? categoriesInput.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    updateChartConfig(ctx, element, config.id, updates);
    modal.remove();
  });

  modal.querySelector('.sdk-modal-overlay').addEventListener('click', () => modal.remove());
  modal.querySelector('.sdk-modal-close').addEventListener('click', () => modal.remove());
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
}
