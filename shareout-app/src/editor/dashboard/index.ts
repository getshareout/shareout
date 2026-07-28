// ShareOut Visual Editor - Dashboard Editor Module

export interface Widget {
  id: string;
  type: 'kpi' | 'chart' | 'table' | 'text' | 'filter' | 'embed';
  title: string;
  position: { x: number; y: number; w: number; h: number };
  config: WidgetConfig;
}

export type WidgetConfig = KpiConfig | ChartWidgetConfig | TableWidgetConfig | TextConfig | FilterConfig | EmbedConfig;

export interface KpiConfig {
  type: 'kpi';
  value: string | DataBinding;
  label: string;
  format: 'number' | 'currency' | 'percent';
  prefix?: string;
  suffix?: string;
  comparison?: { label: string; value: DataBinding; trend?: 'up' | 'down' };
  sparkline?: boolean;
  color?: string;
}

export interface ChartWidgetConfig {
  type: 'chart';
  chartType: 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'donut';
  dataSource: DataBinding;
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
}

export interface TableWidgetConfig {
  type: 'table';
  dataSource: DataBinding;
  columns: ColumnDef[];
  pagination?: boolean;
  pageSize?: number;
  sortable?: boolean;
  filterable?: boolean;
}

export interface ColumnDef {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  format?: 'text' | 'number' | 'currency' | 'date' | 'boolean';
}

export interface TextConfig {
  type: 'text';
  content: string;
  format: 'plain' | 'markdown' | 'html';
  fontSize?: number;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
}

export interface FilterConfig {
  type: 'filter';
  filterType: 'select' | 'multiselect' | 'daterange' | 'search' | 'slider';
  label: string;
  dataSource?: DataBinding;
  options?: { value: string; label: string }[];
  targetWidgets: string[];
  defaultValue?: unknown;
}

export interface EmbedConfig {
  type: 'embed';
  url: string;
  aspectRatio?: string;
}

export interface DataBinding {
  source: 'table' | 'json' | 'api' | 'static';
  tableName?: string;
  jsonKey?: string;
  apiUrl?: string;
  staticValue?: unknown;
  column?: string;
  aggregation?: 'none' | 'count' | 'sum' | 'avg' | 'min' | 'max';
  filter?: string;
}

export interface DashboardConfig {
  artifactId: string;
  widgets: Widget[];
  gridColumns: number;
  gridRowHeight: number;
  gap: number;
  theme: string;
}

export function getDashboardEditorScript(): string {
  return `
    class DashboardEditor {
      constructor(config) {
        this.config = config;
        this.widgets = config.widgets || [];
        this.gridColumns = config.gridColumns || 12;
        this.gridRowHeight = config.gridRowHeight || 60;
        this.gap = config.gap || 16;
        this.selectedWidget = null;
        this.dragState = null;
        this.handlers = {
          onWidgetSelect: () => {},
          onWidgetsUpdate: () => {},
          onFilterChange: () => {},
        };
      }

      renderGrid(container) {
        container.innerHTML = '';
        container.className = 'dashboard-grid';
        container.style.cssText = \`
          display: grid;
          grid-template-columns: repeat(\${this.gridColumns}, 1fr);
          grid-auto-rows: \${this.gridRowHeight}px;
          gap: \${this.gap}px;
          padding: \${this.gap}px;
          min-height: 100%;
          position: relative;
        \`;

        this.widgets.forEach(widget => {
          const el = this.createWidgetElement(widget);
          container.appendChild(el);
        });

        this.initGridInteractions(container);
      }

      createWidgetElement(widget) {
        const el = document.createElement('div');
        el.className = 'dashboard-widget' + (this.selectedWidget === widget.id ? ' selected' : '');
        el.dataset.widgetId = widget.id;
        el.style.cssText = \`
          grid-column: \${widget.position.x + 1} / span \${widget.position.w};
          grid-row: \${widget.position.y + 1} / span \${widget.position.h};
          background: white;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        \`;

        el.innerHTML = \`
          <div class="widget-header">
            <span class="widget-title">\${widget.title}</span>
            <div class="widget-actions">
              <button class="widget-action" data-action="edit" title="Edit">✎</button>
              <button class="widget-action" data-action="delete" title="Delete">×</button>
            </div>
          </div>
          <div class="widget-content" id="widget-content-\${widget.id}"></div>
          <div class="resize-handle"></div>
        \`;

        el.addEventListener('click', (e) => {
          if (!e.target.closest('.widget-action')) {
            this.selectWidget(widget.id);
          }
        });

        el.querySelectorAll('.widget-action').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'edit') this.handlers.onWidgetSelect(widget);
            if (action === 'delete') this.deleteWidget(widget.id);
          });
        });

        this.initWidgetDrag(el, widget);
        this.initWidgetResize(el, widget);

        requestAnimationFrame(() => this.renderWidgetContent(widget));

        return el;
      }

      renderWidgetContent(widget) {
        const container = document.getElementById('widget-content-' + widget.id);
        if (!container) return;

        switch (widget.config.type) {
          case 'kpi':
            this.renderKpiWidget(container, widget.config);
            break;
          case 'chart':
            this.renderChartWidget(container, widget);
            break;
          case 'table':
            this.renderTableWidget(container, widget.config);
            break;
          case 'text':
            this.renderTextWidget(container, widget.config);
            break;
          case 'filter':
            this.renderFilterWidget(container, widget);
            break;
          case 'embed':
            this.renderEmbedWidget(container, widget.config);
            break;
        }
      }

      renderKpiWidget(container, config) {
        const value = typeof config.value === 'object' ? '...' : config.value;
        const formatted = this.formatValue(value, config.format, config.prefix, config.suffix);

        container.innerHTML = \`
          <div class="kpi-widget">
            <div class="kpi-value" style="color: \${config.color || '#111827'}">\${formatted}</div>
            <div class="kpi-label">\${config.label}</div>
            \${config.comparison ? \`
              <div class="kpi-comparison \${config.comparison.trend || ''}">
                \${config.comparison.trend === 'up' ? '↑' : config.comparison.trend === 'down' ? '↓' : ''}
                \${config.comparison.label}
              </div>
            \` : ''}
          </div>
        \`;
      }

      renderChartWidget(container, widget) {
        container.innerHTML = '<div class="chart-placeholder">Chart: ' + widget.config.chartType + '</div>';
        if (window.ShareOutCharts) {
          const chartId = 'chart-' + widget.id;
          container.innerHTML = '<div id="' + chartId + '" style="width:100%;height:100%;"></div>';
          const charts = new window.ShareOutCharts();
          charts.create(chartId, {
            id: chartId,
            type: widget.config.chartType,
            series: [{ name: 'Data', data: [10, 20, 30, 40, 50] }],
            categories: ['A', 'B', 'C', 'D', 'E'],
            colors: widget.config.colors,
            showLegend: widget.config.showLegend,
            showGrid: widget.config.showGrid,
          });
        }
      }

      renderTableWidget(container, config) {
        const columns = config.columns || [{ key: 'col1', label: 'Column 1' }];
        container.innerHTML = \`
          <div class="table-widget">
            <table>
              <thead><tr>\${columns.map(c => '<th>' + c.label + '</th>').join('')}</tr></thead>
              <tbody><tr>\${columns.map(() => '<td>—</td>').join('')}</tr></tbody>
            </table>
          </div>
        \`;
      }

      renderTextWidget(container, config) {
        container.innerHTML = '<div class="text-widget" style="font-size:' + (config.fontSize || 14) + 'px;text-align:' + (config.textAlign || 'left') + '">' + (config.content || 'Text content') + '</div>';
      }

      renderFilterWidget(container, widget) {
        const config = widget.config;
        let html = '<div class="filter-widget"><label>' + config.label + '</label>';

        switch (config.filterType) {
          case 'select':
          case 'multiselect':
            const options = config.options || [{ value: '', label: 'Select...' }];
            html += '<select ' + (config.filterType === 'multiselect' ? 'multiple' : '') + '>' + options.map(o => '<option value="' + o.value + '">' + o.label + '</option>').join('') + '</select>';
            break;
          case 'search':
            html += '<input type="search" placeholder="Search...">';
            break;
          case 'daterange':
            html += '<input type="date"> <span>to</span> <input type="date">';
            break;
          case 'slider':
            html += '<input type="range" min="0" max="100">';
            break;
        }

        html += '</div>';
        container.innerHTML = html;

        container.querySelector('select, input')?.addEventListener('change', (e) => {
          this.handlers.onFilterChange(widget.id, e.target.value, config.targetWidgets);
        });
      }

      renderEmbedWidget(container, config) {
        if (config.url) {
          container.innerHTML = '<iframe src="' + config.url + '" style="width:100%;height:100%;border:none;"></iframe>';
        } else {
          container.innerHTML = '<div class="embed-placeholder">Enter URL to embed</div>';
        }
      }

      formatValue(value, format, prefix = '', suffix = '') {
        let formatted = value;
        switch (format) {
          case 'currency':
            formatted = '$' + Number(value).toLocaleString();
            break;
          case 'percent':
            formatted = Number(value).toFixed(1) + '%';
            break;
          case 'number':
            formatted = Number(value).toLocaleString();
            break;
        }
        return prefix + formatted + suffix;
      }

      initWidgetDrag(el, widget) {
        const header = el.querySelector('.widget-header');
        header.style.cursor = 'move';

        header.addEventListener('mousedown', (e) => {
          if (e.target.closest('.widget-action')) return;
          e.preventDefault();
          this.dragState = {
            widget,
            startX: e.clientX,
            startY: e.clientY,
            origX: widget.position.x,
            origY: widget.position.y,
          };
          el.classList.add('dragging');
        });
      }

      initWidgetResize(el, widget) {
        const handle = el.querySelector('.resize-handle');
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.dragState = {
            widget,
            resize: true,
            startX: e.clientX,
            startY: e.clientY,
            origW: widget.position.w,
            origH: widget.position.h,
          };
          el.classList.add('resizing');
        });
      }

      initGridInteractions(container) {
        const cellWidth = container.offsetWidth / this.gridColumns;
        const cellHeight = this.gridRowHeight;

        document.addEventListener('mousemove', (e) => {
          if (!this.dragState) return;

          const dx = e.clientX - this.dragState.startX;
          const dy = e.clientY - this.dragState.startY;

          if (this.dragState.resize) {
            const newW = Math.max(1, Math.round((this.dragState.origW * cellWidth + dx) / cellWidth));
            const newH = Math.max(1, Math.round((this.dragState.origH * cellHeight + dy) / cellHeight));
            this.dragState.widget.position.w = Math.min(newW, this.gridColumns - this.dragState.widget.position.x);
            this.dragState.widget.position.h = newH;
          } else {
            const newX = Math.max(0, Math.min(this.gridColumns - this.dragState.widget.position.w, this.dragState.origX + Math.round(dx / cellWidth)));
            const newY = Math.max(0, this.dragState.origY + Math.round(dy / cellHeight));
            this.dragState.widget.position.x = newX;
            this.dragState.widget.position.y = newY;
          }

          this.renderGrid(container);
        });

        document.addEventListener('mouseup', () => {
          if (this.dragState) {
            this.handlers.onWidgetsUpdate(this.widgets);
            this.dragState = null;
          }
        });
      }

      selectWidget(id) {
        this.selectedWidget = id;
        document.querySelectorAll('.dashboard-widget').forEach(el => {
          el.classList.toggle('selected', el.dataset.widgetId === id);
        });
        const widget = this.widgets.find(w => w.id === id);
        this.handlers.onWidgetSelect(widget);
      }

      addWidget(type, template = {}) {
        const defaults = {
          kpi: { type: 'kpi', value: '0', label: 'KPI', format: 'number' },
          chart: { type: 'chart', chartType: 'bar', dataSource: { source: 'static' } },
          table: { type: 'table', dataSource: { source: 'static' }, columns: [{ key: 'col1', label: 'Column' }] },
          text: { type: 'text', content: 'Text block', format: 'plain' },
          filter: { type: 'filter', filterType: 'select', label: 'Filter', targetWidgets: [] },
          embed: { type: 'embed', url: '' },
        };

        const widget = {
          id: 'widget-' + Date.now(),
          type,
          title: type.charAt(0).toUpperCase() + type.slice(1),
          position: this.findEmptyPosition(type === 'kpi' ? 3 : 4, type === 'kpi' ? 2 : 4),
          config: { ...defaults[type], ...template },
        };

        this.widgets.push(widget);
        this.handlers.onWidgetsUpdate(this.widgets);
        this.renderGrid(document.querySelector('.dashboard-grid'));
        this.selectWidget(widget.id);
      }

      findEmptyPosition(w, h) {
        const occupied = new Set();
        this.widgets.forEach(widget => {
          for (let x = widget.position.x; x < widget.position.x + widget.position.w; x++) {
            for (let y = widget.position.y; y < widget.position.y + widget.position.h; y++) {
              occupied.add(x + ',' + y);
            }
          }
        });

        for (let y = 0; y < 100; y++) {
          for (let x = 0; x <= this.gridColumns - w; x++) {
            let fits = true;
            for (let dx = 0; dx < w && fits; dx++) {
              for (let dy = 0; dy < h && fits; dy++) {
                if (occupied.has((x + dx) + ',' + (y + dy))) fits = false;
              }
            }
            if (fits) return { x, y, w, h };
          }
        }

        return { x: 0, y: 0, w, h };
      }

      deleteWidget(id) {
        this.widgets = this.widgets.filter(w => w.id !== id);
        if (this.selectedWidget === id) this.selectedWidget = null;
        this.handlers.onWidgetsUpdate(this.widgets);
        this.renderGrid(document.querySelector('.dashboard-grid'));
      }

      updateWidget(id, updates) {
        const widget = this.widgets.find(w => w.id === id);
        if (widget) {
          Object.assign(widget, updates);
          if (updates.config) widget.config = { ...widget.config, ...updates.config };
          this.handlers.onWidgetsUpdate(this.widgets);
          this.renderGrid(document.querySelector('.dashboard-grid'));
        }
      }

      renderPalette(container) {
        const widgetTypes = [
          { type: 'kpi', icon: '#', name: 'KPI' },
          { type: 'chart', icon: '📊', name: 'Chart' },
          { type: 'table', icon: '▤', name: 'Table' },
          { type: 'text', icon: 'T', name: 'Text' },
          { type: 'filter', icon: '▼', name: 'Filter' },
          { type: 'embed', icon: '⧉', name: 'Embed' },
        ];

        container.innerHTML = widgetTypes.map(w => \`
          <div class="widget-type" data-type="\${w.type}" draggable="true">
            <div class="widget-type-icon">\${w.icon}</div>
            <div class="widget-type-name">\${w.name}</div>
          </div>
        \`).join('');

        container.querySelectorAll('.widget-type').forEach(el => {
          el.addEventListener('click', () => this.addWidget(el.dataset.type));
          el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('widget-type', el.dataset.type);
          });
        });
      }

      renderProperties(container, widget) {
        if (!widget) {
          container.innerHTML = '<div class="no-selection">Select a widget</div>';
          return;
        }

        let propsHtml = \`
          <div class="prop-section">
            <div class="prop-section-title">Widget</div>
            <div class="prop-row">
              <label>Title</label>
              <input type="text" id="widget-title" value="\${widget.title}">
            </div>
          </div>
        \`;

        switch (widget.config.type) {
          case 'kpi':
            propsHtml += this.renderKpiProperties(widget.config);
            break;
          case 'chart':
            propsHtml += this.renderChartProperties(widget.config);
            break;
          case 'table':
            propsHtml += this.renderTableProperties(widget.config);
            break;
          case 'filter':
            propsHtml += this.renderFilterProperties(widget.config);
            break;
        }

        container.innerHTML = propsHtml;

        container.querySelector('#widget-title')?.addEventListener('change', (e) => {
          this.updateWidget(widget.id, { title: e.target.value });
        });

        this.bindPropertyEvents(container, widget);
      }

      renderKpiProperties(config) {
        return \`
          <div class="prop-section">
            <div class="prop-section-title">KPI Settings</div>
            <div class="prop-row">
              <label>Value</label>
              <input type="text" id="kpi-value" value="\${typeof config.value === 'string' ? config.value : ''}">
            </div>
            <div class="prop-row">
              <label>Label</label>
              <input type="text" id="kpi-label" value="\${config.label || ''}">
            </div>
            <div class="prop-row">
              <label>Format</label>
              <select id="kpi-format">
                <option value="number" \${config.format === 'number' ? 'selected' : ''}>Number</option>
                <option value="currency" \${config.format === 'currency' ? 'selected' : ''}>Currency</option>
                <option value="percent" \${config.format === 'percent' ? 'selected' : ''}>Percent</option>
              </select>
            </div>
            <div class="prop-row">
              <label>Color</label>
              <input type="color" id="kpi-color" value="\${config.color || '#111827'}">
            </div>
          </div>
        \`;
      }

      renderChartProperties(config) {
        return \`
          <div class="prop-section">
            <div class="prop-section-title">Chart Settings</div>
            <div class="prop-row">
              <label>Type</label>
              <select id="chart-type">
                <option value="bar" \${config.chartType === 'bar' ? 'selected' : ''}>Bar</option>
                <option value="line" \${config.chartType === 'line' ? 'selected' : ''}>Line</option>
                <option value="pie" \${config.chartType === 'pie' ? 'selected' : ''}>Pie</option>
                <option value="area" \${config.chartType === 'area' ? 'selected' : ''}>Area</option>
                <option value="scatter" \${config.chartType === 'scatter' ? 'selected' : ''}>Scatter</option>
                <option value="donut" \${config.chartType === 'donut' ? 'selected' : ''}>Donut</option>
              </select>
            </div>
            <div class="prop-row">
              <label>Show Legend</label>
              <input type="checkbox" id="chart-legend" \${config.showLegend ? 'checked' : ''}>
            </div>
            <div class="prop-row">
              <label>Show Grid</label>
              <input type="checkbox" id="chart-grid" \${config.showGrid ? 'checked' : ''}>
            </div>
          </div>
        \`;
      }

      renderTableProperties(config) {
        return \`
          <div class="prop-section">
            <div class="prop-section-title">Table Settings</div>
            <div class="prop-row">
              <label>Pagination</label>
              <input type="checkbox" id="table-pagination" \${config.pagination ? 'checked' : ''}>
            </div>
            <div class="prop-row">
              <label>Sortable</label>
              <input type="checkbox" id="table-sortable" \${config.sortable ? 'checked' : ''}>
            </div>
            <div class="prop-row">
              <label>Filterable</label>
              <input type="checkbox" id="table-filterable" \${config.filterable ? 'checked' : ''}>
            </div>
          </div>
        \`;
      }

      renderFilterProperties(config) {
        return \`
          <div class="prop-section">
            <div class="prop-section-title">Filter Settings</div>
            <div class="prop-row">
              <label>Type</label>
              <select id="filter-type">
                <option value="select" \${config.filterType === 'select' ? 'selected' : ''}>Select</option>
                <option value="multiselect" \${config.filterType === 'multiselect' ? 'selected' : ''}>Multi-select</option>
                <option value="search" \${config.filterType === 'search' ? 'selected' : ''}>Search</option>
                <option value="daterange" \${config.filterType === 'daterange' ? 'selected' : ''}>Date Range</option>
                <option value="slider" \${config.filterType === 'slider' ? 'selected' : ''}>Slider</option>
              </select>
            </div>
            <div class="prop-row">
              <label>Label</label>
              <input type="text" id="filter-label" value="\${config.label || ''}">
            </div>
          </div>
        \`;
      }

      bindPropertyEvents(container, widget) {
        const bindings = {
          'kpi-value': (v) => this.updateWidget(widget.id, { config: { value: v } }),
          'kpi-label': (v) => this.updateWidget(widget.id, { config: { label: v } }),
          'kpi-format': (v) => this.updateWidget(widget.id, { config: { format: v } }),
          'kpi-color': (v) => this.updateWidget(widget.id, { config: { color: v } }),
          'chart-type': (v) => this.updateWidget(widget.id, { config: { chartType: v } }),
          'chart-legend': (v) => this.updateWidget(widget.id, { config: { showLegend: v } }),
          'chart-grid': (v) => this.updateWidget(widget.id, { config: { showGrid: v } }),
          'table-pagination': (v) => this.updateWidget(widget.id, { config: { pagination: v } }),
          'table-sortable': (v) => this.updateWidget(widget.id, { config: { sortable: v } }),
          'table-filterable': (v) => this.updateWidget(widget.id, { config: { filterable: v } }),
          'filter-type': (v) => this.updateWidget(widget.id, { config: { filterType: v } }),
          'filter-label': (v) => this.updateWidget(widget.id, { config: { label: v } }),
        };

        Object.entries(bindings).forEach(([id, handler]) => {
          const el = container.querySelector('#' + id);
          if (el) {
            el.addEventListener('change', (e) => {
              const value = el.type === 'checkbox' ? el.checked : el.value;
              handler(value);
            });
          }
        });
      }

      on(event, handler) {
        const key = 'on' + event.charAt(0).toUpperCase() + event.slice(1);
        if (this.handlers[key] !== undefined) {
          this.handlers[key] = handler;
        }
      }
    }

    window.DashboardEditor = DashboardEditor;
  `;
}

export function getDashboardStyles(): string {
  return `
    .dashboard-grid {
      background: var(--bg-tertiary);
      background-image:
        linear-gradient(to right, var(--border-color) 1px, transparent 1px),
        linear-gradient(to bottom, var(--border-color) 1px, transparent 1px);
      background-size: calc(100% / 12) 60px;
    }

    .dashboard-widget {
      cursor: default;
      transition: box-shadow 0.15s;
    }

    .dashboard-widget:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .dashboard-widget.selected {
      outline: 2px solid var(--accent);
    }

    .dashboard-widget.dragging,
    .dashboard-widget.resizing {
      opacity: 0.8;
      z-index: 100;
    }

    .widget-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
    }

    .widget-title {
      font-weight: 500;
      font-size: 13px;
    }

    .widget-actions {
      display: flex;
      gap: 4px;
    }

    .widget-action {
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 4px;
      color: var(--text-muted);
    }

    .widget-action:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }

    .widget-content {
      flex: 1;
      overflow: auto;
      padding: 12px;
    }

    .resize-handle {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      cursor: se-resize;
      background: linear-gradient(135deg, transparent 50%, var(--border-color) 50%);
    }

    .kpi-widget {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      text-align: center;
    }

    .kpi-value {
      font-size: 36px;
      font-weight: 600;
      line-height: 1.2;
    }

    .kpi-label {
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: 4px;
    }

    .kpi-comparison {
      font-size: 12px;
      margin-top: 8px;
    }

    .kpi-comparison.up {
      color: #10b981;
    }

    .kpi-comparison.down {
      color: #ef4444;
    }

    .table-widget table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .table-widget th,
    .table-widget td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }

    .table-widget th {
      background: var(--bg-secondary);
      font-weight: 500;
    }

    .text-widget {
      height: 100%;
    }

    .filter-widget {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .filter-widget label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
    }

    .filter-widget select,
    .filter-widget input {
      padding: 8px 12px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      font-size: 13px;
    }

    .widget-type {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 12px 8px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .widget-type:hover {
      background: var(--bg-tertiary);
      border-color: var(--accent);
    }

    .widget-type-icon {
      font-size: 20px;
    }

    .widget-type-name {
      font-size: 11px;
      color: var(--text-muted);
    }

    .chart-placeholder,
    .embed-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
    }
  `;
}
