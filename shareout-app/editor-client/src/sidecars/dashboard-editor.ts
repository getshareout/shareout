/** Dashboard grid helper used by the dashboard palette. */

import { colors, fonts } from '@shareout/design-tokens';

export interface DashboardWidget {
  id: string;
  type: string;
  title: string;
  position: { x: number; y: number; w: number; h: number };
  config: Record<string, unknown>;
}

const DASHBOARD_STYLES_ID = 'so-dashboard-sidecar-css';

const DASHBOARD_SIDECAR_CSS = `
.dashboard-grid {
  display: grid;
  gap: 16px;
  padding: 16px;
  min-height: 100%;
  background: ${colors.surface};
  font-family: ${fonts.body};
}
.dashboard-widget {
  background: ${colors.bgElevated};
  border: 1px solid ${colors.border};
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: ${colors.text};
}
.dashboard-widget.selected {
  outline: 2px solid ${colors.primary};
}
.widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid ${colors.border};
  background: ${colors.surface};
  min-height: 48px;
}
.widget-title {
  font-weight: 600;
  font-size: 14px;
  color: ${colors.text};
}
.widget-actions {
  display: flex;
  gap: 4px;
}
.widget-action {
  width: 44px;
  height: 44px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  color: ${colors.textSecondary};
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: background 0.15s;
}
.widget-action:hover {
  background: ${colors.border};
  color: ${colors.text};
}
.widget-content {
  flex: 1;
  padding: 16px;
  background: ${colors.bgElevated};
}
.kpi-widget {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.kpi-value {
  font-size: 32px;
  font-weight: 700;
  color: ${colors.text};
}
.kpi-label {
  font-size: 14px;
  color: ${colors.textSecondary};
  margin-top: 4px;
}
.chart-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: ${colors.textSecondary};
  background: ${colors.surface};
  border-radius: 8px;
}
.table-widget {
  height: 100%;
  overflow: auto;
}
.table-widget table {
  width: 100%;
  border-collapse: collapse;
}
.table-widget th {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid ${colors.border};
  font-weight: 600;
  color: ${colors.text};
}
.table-widget td {
  padding: 8px 12px;
  color: ${colors.textSecondary};
}
.text-widget {
  color: ${colors.text};
  line-height: 1.5;
}
.filter-widget {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.filter-widget label {
  font-size: 14px;
  font-weight: 600;
  color: ${colors.text};
}
.filter-widget select {
  padding: 10px 12px;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  font-size: 14px;
  color: ${colors.text};
  background: ${colors.bgElevated};
  min-height: 44px;
  cursor: pointer;
}
.widget-fallback {
  color: ${colors.textSecondary};
}
`;

function ensureDashboardStyles(doc: Document): void {
  if (doc.getElementById(DASHBOARD_STYLES_ID)) return;
  const style = doc.createElement('style');
  style.id = DASHBOARD_STYLES_ID;
  style.textContent = DASHBOARD_SIDECAR_CSS;
  doc.head.appendChild(style);
}

export class DashboardEditor {
  widgets: DashboardWidget[];
  gridColumns: number;
  gridRowHeight: number;
  selectedWidget: string | null = null;
  handlers: {
    onWidgetSelect: (widget: DashboardWidget | undefined) => void;
    onWidgetsUpdate: (widgets: DashboardWidget[]) => void;
    onFilterChange: () => void;
  };

  constructor(config: { widgets?: DashboardWidget[]; gridColumns?: number; gridRowHeight?: number }) {
    this.widgets = config.widgets ?? [];
    this.gridColumns = config.gridColumns ?? 12;
    this.gridRowHeight = config.gridRowHeight ?? 60;
    this.handlers = {
      onWidgetSelect: () => {},
      onWidgetsUpdate: () => {},
      onFilterChange: () => {},
    };
  }

  addWidget(type: string): void {
    const defaults: Record<string, Record<string, unknown>> = {
      kpi: { type: 'kpi', value: '0', label: 'KPI', format: 'number' },
      chart: { type: 'chart', chartType: 'bar' },
      table: { type: 'table', columns: [{ key: 'col1', label: 'Column' }] },
      text: { type: 'text', content: 'Text' },
      filter: { type: 'filter', filterType: 'select', label: 'Filter', targetWidgets: [] },
    };
    const widget: DashboardWidget = {
      id: `widget-${Date.now()}`,
      type,
      title: type.charAt(0).toUpperCase() + type.slice(1),
      position: this.findEmptyPosition(type === 'kpi' ? 3 : 4, type === 'kpi' ? 2 : 4),
      config: defaults[type] ?? {},
    };
    this.widgets.push(widget);
    this.handlers.onWidgetsUpdate(this.widgets);
    const grid = document.querySelector('.dashboard-grid');
    if (grid) this.renderGrid(grid as HTMLElement);
  }

  findEmptyPosition(w: number, h: number): { x: number; y: number; w: number; h: number } {
    const occupied = new Set<string>();
    for (const widget of this.widgets) {
      for (let x = widget.position.x; x < widget.position.x + widget.position.w; x++) {
        for (let y = widget.position.y; y < widget.position.y + widget.position.h; y++) {
          occupied.add(`${x},${y}`);
        }
      }
    }
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x <= this.gridColumns - w; x++) {
        let fits = true;
        for (let dx = 0; dx < w && fits; dx++) {
          for (let dy = 0; dy < h && fits; dy++) {
            if (occupied.has(`${x + dx},${y + dy}`)) fits = false;
          }
        }
        if (fits) return { x, y, w, h };
      }
    }
    return { x: 0, y: 0, w, h };
  }

  renderGrid(container: HTMLElement): void {
    ensureDashboardStyles(container.ownerDocument);
    container.innerHTML = '';
    container.className = 'dashboard-grid';
    container.style.gridTemplateColumns = `repeat(${this.gridColumns}, 1fr)`;
    container.style.gridAutoRows = `${this.gridRowHeight}px`;
    for (const w of this.widgets) {
      container.appendChild(this.createWidgetElement(w));
    }
  }

  createWidgetElement(widget: DashboardWidget): HTMLElement {
    const el = document.createElement('div');
    el.className = 'dashboard-widget' + (this.selectedWidget === widget.id ? ' selected' : '');
    el.dataset.widgetId = widget.id;
    el.style.gridColumn = `${widget.position.x + 1} / span ${widget.position.w}`;
    el.style.gridRow = `${widget.position.y + 1} / span ${widget.position.h}`;
    el.innerHTML = `<div class="widget-header"><span class="widget-title">${widget.title}</span><div class="widget-actions"><button type="button" class="widget-action" data-action="delete" title="Delete">×</button></div></div><div class="widget-content" id="widget-content-${widget.id}"></div>`;
    el.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.widget-action')) this.selectWidget(widget.id);
    });
    el.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteWidget(widget.id);
    });
    requestAnimationFrame(() => this.renderWidgetContent(widget));
    return el;
  }

  renderWidgetContent(widget: DashboardWidget): void {
    const container = document.getElementById(`widget-content-${widget.id}`);
    if (!container) return;
    const cfg = widget.config;
    switch (cfg.type) {
      case 'kpi':
        container.innerHTML = `<div class="kpi-widget"><div class="kpi-value">${cfg.value ?? '0'}</div><div class="kpi-label">${cfg.label ?? ''}</div></div>`;
        break;
      case 'chart':
        container.innerHTML = `<div class="chart-placeholder">Chart: ${cfg.chartType ?? 'bar'}</div>`;
        break;
      case 'table':
        container.innerHTML =
          '<div class="table-widget"><table><thead><tr><th>Column</th></tr></thead><tbody><tr><td>-</td></tr></tbody></table></div>';
        break;
      case 'text':
        container.innerHTML = `<div class="text-widget">${cfg.content ?? ''}</div>`;
        break;
      case 'filter':
        container.innerHTML = `<div class="filter-widget"><label>${cfg.label ?? 'Filter'}</label><select><option>Select...</option></select></div>`;
        break;
      default:
        container.innerHTML = '<div class="widget-fallback">Widget</div>';
    }
  }

  selectWidget(id: string): void {
    this.selectedWidget = id;
    document.querySelectorAll('.dashboard-widget').forEach((el) => {
      el.classList.toggle('selected', (el as HTMLElement).dataset.widgetId === id);
    });
    this.handlers.onWidgetSelect(this.widgets.find((w) => w.id === id));
  }

  deleteWidget(id: string): void {
    this.widgets = this.widgets.filter((w) => w.id !== id);
    if (this.selectedWidget === id) this.selectedWidget = null;
    this.handlers.onWidgetsUpdate(this.widgets);
    const grid = document.querySelector('.dashboard-grid');
    if (grid) this.renderGrid(grid as HTMLElement);
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    const key = ('on' + event.charAt(0).toUpperCase() + event.slice(1)) as keyof typeof this.handlers;
    if (key in this.handlers) {
      (this.handlers as Record<string, (...args: unknown[]) => void>)[key] = handler;
    }
  }
}
