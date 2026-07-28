/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDashboardEditorScript,
  getDashboardStyles,
} from '../../../src/editor/dashboard/index';
import { loadEditorClass, flushAnimationFrames } from './helpers/load-editor-script';

interface DashboardEditorInstance {
  widgets: Array<{
    id: string;
    type: string;
    title: string;
    position: { x: number; y: number; w: number; h: number };
    config: Record<string, unknown>;
  }>;
  gridColumns: number;
  selectedWidget: string | null;
  handlers: {
    onWidgetSelect: (widget: unknown) => void;
    onWidgetsUpdate: (widgets: unknown[]) => void;
    onFilterChange: (id: string, value: unknown, targets: string[]) => void;
  };
  renderGrid: (container: HTMLElement) => void;
  renderPalette: (container: HTMLElement) => void;
  renderProperties: (container: HTMLElement, widget: unknown) => void;
  addWidget: (type: string, template?: Record<string, unknown>) => void;
  deleteWidget: (id: string) => void;
  updateWidget: (id: string, updates: Record<string, unknown>) => void;
  selectWidget: (id: string) => void;
  formatValue: (value: string, format: string, prefix?: string, suffix?: string) => string;
  findEmptyPosition: (w: number, h: number) => { x: number; y: number; w: number; h: number };
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

const sampleWidget = {
  id: 'widget-1',
  type: 'kpi' as const,
  title: 'Revenue',
  position: { x: 0, y: 0, w: 3, h: 2 },
  config: {
    type: 'kpi',
    value: '1200',
    label: 'Monthly',
    format: 'currency' as const,
    comparison: { label: 'vs last month', trend: 'up' as const },
  },
};

describe('getDashboardStyles', () => {
  it('includes dashboard layout and widget classes', () => {
    const css = getDashboardStyles();
    expect(css).toContain('.dashboard-grid');
    expect(css).toContain('.dashboard-widget.selected');
    expect(css).toContain('.kpi-value');
    expect(css).toContain('.widget-type');
  });
});

describe('DashboardEditor', () => {
  let DashboardEditor: new (config: Record<string, unknown>) => DashboardEditorInstance;
  let editor: DashboardEditorInstance;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div><div class="dashboard-grid"></div>';
    DashboardEditor = loadEditorClass(getDashboardEditorScript(), 'DashboardEditor');
    editor = new DashboardEditor({
      artifactId: 'art_1',
      widgets: [structuredClone(sampleWidget)],
      gridColumns: 12,
      gridRowHeight: 60,
      gap: 16,
    });
  });

  it('renders widgets on the grid', async () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    editor.renderGrid(grid);
    await flushAnimationFrames();

    expect(grid.className).toBe('dashboard-grid');
    expect(grid.querySelectorAll('.dashboard-widget')).toHaveLength(1);
    expect(grid.querySelector('.kpi-value')?.textContent).toContain('$');
    expect(grid.querySelector('.kpi-comparison.up')).toBeTruthy();
  });

  it('renders chart, table, text, filter, and embed widget types', async () => {
    editor.widgets = [
      {
        id: 'w-chart', type: 'chart', title: 'Chart', position: { x: 0, y: 0, w: 4, h: 4 },
        config: { type: 'chart', chartType: 'bar', dataSource: { source: 'static' } },
      },
      {
        id: 'w-table', type: 'table', title: 'Table', position: { x: 4, y: 0, w: 4, h: 4 },
        config: { type: 'table', dataSource: { source: 'static' }, columns: [{ key: 'a', label: 'A' }] },
      },
      {
        id: 'w-text', type: 'text', title: 'Text', position: { x: 8, y: 0, w: 4, h: 2 },
        config: { type: 'text', content: 'Hello', format: 'plain', fontSize: 18 },
      },
      {
        id: 'w-filter', type: 'filter', title: 'Filter', position: { x: 0, y: 4, w: 3, h: 2 },
        config: { type: 'filter', filterType: 'search', label: 'Search', targetWidgets: ['w-chart'] },
      },
      {
        id: 'w-embed', type: 'embed', title: 'Embed', position: { x: 3, y: 4, w: 4, h: 3 },
        config: { type: 'embed', url: 'https://example.com' },
      },
    ];

    const grid = document.createElement('div');
    document.body.appendChild(grid);
    editor.renderGrid(grid);
    await flushAnimationFrames();

    expect(grid.querySelector('.chart-placeholder, #chart-w-chart')).toBeTruthy();
    expect(grid.querySelector('.table-widget table th')?.textContent).toBe('A');
    expect(grid.querySelector('.text-widget')?.textContent).toBe('Hello');
    expect(grid.querySelector('.filter-widget input[type="search"]')).toBeTruthy();
    expect(grid.querySelector('iframe')?.getAttribute('src')).toBe('https://example.com');
  });

  it('uses ShareOutCharts when available', async () => {
    const create = vi.fn();
    (window as unknown as { ShareOutCharts: new () => { create: typeof create } }).ShareOutCharts = class {
      create = create;
    };

    editor.widgets = [{
      id: 'w-chart', type: 'chart', title: 'Chart', position: { x: 0, y: 0, w: 4, h: 4 },
      config: { type: 'chart', chartType: 'line', dataSource: { source: 'static' }, showLegend: true },
    }];

    const grid = document.createElement('div');
    document.body.appendChild(grid);
    editor.renderGrid(grid);
    await flushAnimationFrames();
    expect(create).toHaveBeenCalled();
  });

  it('selects widget and fires handler', () => {
    const onSelect = vi.fn();
    editor.on('widgetSelect', onSelect);

    const grid = document.createElement('div');
    document.body.appendChild(grid);
    editor.renderGrid(grid);
    editor.selectWidget('widget-1');

    expect(editor.selectedWidget).toBe('widget-1');
    expect(grid.querySelector('.dashboard-widget.selected')).toBeTruthy();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'widget-1' }));
  });

  it('adds and deletes widgets via palette', () => {
    const onUpdate = vi.fn();
    editor.on('widgetsUpdate', onUpdate);

    const palette = document.createElement('div');
    editor.renderPalette(palette);
    expect(palette.querySelectorAll('.widget-type')).toHaveLength(6);

    palette.querySelector('[data-type="text"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(editor.widgets.length).toBeGreaterThan(1);
    expect(onUpdate).toHaveBeenCalled();

    const id = editor.widgets[editor.widgets.length - 1].id;
    editor.deleteWidget(id);
    expect(editor.widgets.some((w) => w.id === id)).toBe(false);
  });

  it('updates widget properties from panel', () => {
    const props = document.createElement('div');
    editor.renderProperties(props, sampleWidget);

    expect(props.querySelector('#widget-title')).toBeTruthy();
    expect(props.querySelector('#kpi-format')).toBeTruthy();
    expect(props.textContent).toContain('KPI Settings');
  });

  it('shows no-selection message when widget is null', () => {
    const props = document.createElement('div');
    editor.renderProperties(props, null);
    expect(props.textContent).toContain('Select a widget');
  });

  it('formats KPI values', () => {
    expect(editor.formatValue('1000', 'currency')).toContain('$');
    expect(editor.formatValue('42.5', 'percent')).toContain('%');
    expect(editor.formatValue('1000', 'number')).toContain('1');
    expect(editor.formatValue('5', 'number', '>', '!')).toBe('>5!');
  });

  it('finds empty grid position avoiding occupied cells', () => {
    editor.widgets = [{
      id: 'w1', type: 'kpi', title: 'KPI', position: { x: 0, y: 0, w: 3, h: 2 },
      config: { type: 'kpi', value: '1', label: 'L', format: 'number' },
    }];
    const pos = editor.findEmptyPosition(3, 2);
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.w).toBe(3);
  });

  it('handles filter change events', async () => {
    const onFilter = vi.fn();
    editor.on('filterChange', onFilter);

    editor.widgets = [{
      id: 'wf', type: 'filter', title: 'F', position: { x: 0, y: 0, w: 3, h: 2 },
      config: {
        type: 'filter',
        filterType: 'select',
        label: 'Region',
        options: [{ value: 'us', label: 'US' }],
        targetWidgets: ['widget-1'],
      },
    }];

    const grid = document.createElement('div');
    document.body.appendChild(grid);
    editor.renderGrid(grid);
    await flushAnimationFrames();
    const select = grid.querySelector('select') as HTMLSelectElement;
    select.value = 'us';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onFilter).toHaveBeenCalledWith('wf', 'us', ['widget-1']);
  });

  it('delete action removes widget from rendered grid', () => {
    const grid = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(grid);
    grid.className = 'dashboard-grid';
    editor.renderGrid(grid);

    grid.querySelector('[data-action="delete"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(editor.widgets).toHaveLength(0);
  });
});
