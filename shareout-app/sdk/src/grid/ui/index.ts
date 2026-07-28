import { TabulatorFull, type ColumnDefinition, type CellComponent } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator.min.css';
import './theme.css';
import type { Grid } from '../../stores/grid-store';
import type { GridColumn } from '../types';

export interface MountOptions {
  editable?: boolean;
  height?: string;
  pageSize?: number;
}

export interface GridController {
  table: TabulatorFull;
  addRow(data?: Record<string, unknown>): Promise<void>;
  destroy(): void;
}

type Editor = NonNullable<ColumnDefinition['editor']>;

function editorFor(type: GridColumn['type']): Editor {
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'tickCross';
  if (type === 'date') return 'date';
  return 'input';
}

function toColumns(columns: GridColumn[], editable: boolean): ColumnDefinition[] {
  return columns.map((c) => {
    const numeric = c.type === 'number';
    const def: ColumnDefinition = {
      title: c.title,
      field: c.field,
      formatter: c.type === 'boolean' ? 'tickCross' : undefined,
      sorter: numeric ? 'number' : 'string',
      minWidth: numeric ? 104 : c.type === 'boolean' ? 88 : 120,
      hozAlign: numeric ? 'right' : c.type === 'boolean' ? 'center' : 'left',
      headerHozAlign: numeric ? 'right' : c.type === 'boolean' ? 'center' : 'left',
      resizable: true,
    };
    // Author width control wins; otherwise text columns claim more of the
    // leftover width so values aren't truncated and numbers stay compact.
    if (c.width != null) def.width = c.width;
    else def.widthGrow = c.widthGrow ?? (c.type === 'text' ? 3 : 1);
    if (editable && c.editable !== false) def.editor = editorFor(c.type);
    return def;
  });
}

// Inject the grid stylesheet (Tabulator base + ShareOut theme) once. Resolved
// from import.meta.url — i.e. the same origin grid.js was loaded from — so it is
// always same-origin ('self') and never tripped by the artifact CSP, on the app
// host or a per-artifact content host.
function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('so-grid-css')) return;
  const link = document.createElement('link');
  link.id = 'so-grid-css';
  link.rel = 'stylesheet';
  link.href = new URL('./grid.css', import.meta.url).href;
  document.head.appendChild(link);
}

/**
 * Mount a themed Tabulator over a Grid. Lazily loaded from /sdk/grid.js by
 * Grid.render() so non-grid artifacts never download Tabulator.
 */
export async function mountGrid(
  target: string | HTMLElement,
  grid: Grid,
  opts: MountOptions = {}
): Promise<GridController> {
  ensureStyles();
  const host = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!host) throw new Error(`Grid target not found: ${String(target)}`);

  const editable = opts.editable ?? true;
  const { rows, columns } = await grid.load({ limit: opts.pageSize ?? 100 });

  host.classList.add('so-grid-wrap');
  const tableEl = document.createElement('div');

  let toolbar: HTMLElement | undefined;
  if (editable) {
    toolbar = document.createElement('div');
    toolbar.className = 'so-grid-toolbar';
    const addBtn = document.createElement('button');
    addBtn.className = 'so-grid-add';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add row';
    toolbar.appendChild(addBtn);
    host.appendChild(toolbar);
    addBtn.addEventListener('click', () => controller.addRow());
  }
  host.appendChild(tableEl);

  const columnDefs = toColumns(columns, editable);
  if (editable) {
    columnDefs.push({
      title: '',
      field: '_del',
      width: 84,
      hozAlign: 'center',
      headerSort: false,
      resizable: false,
      cssClass: 'so-grid-delcol',
      formatter: () => '<button class="so-grid-del" type="button" aria-label="Delete row">Remove</button>',
      cellClick: async (_e: UIEvent, cell: CellComponent) => {
        const id = String(cell.getRow().getData().id);
        await grid.deleteRow(id);
        cell.getRow().delete();
      },
    });
  }

  const table = new TabulatorFull(tableEl, {
    data: rows,
    layout: 'fitColumns',
    // No fixed height unless the author asks: small grids size to content
    // (no dead space); large grids should pass a height to enable scrolling.
    ...(opts.height ? { height: opts.height } : {}),
    index: 'id',
    columns: columnDefs,
  });

  table.on('cellEdited', (cell: CellComponent) => {
    const id = String(cell.getRow().getData().id);
    void grid.setCell(id, cell.getField(), cell.getValue());
  });

  const controller: GridController = {
    table,
    async addRow(data = {}) {
      const row = await grid.addRow(data);
      await table.addRow(row);
    },
    destroy() {
      table.destroy();
      toolbar?.remove();
      host.classList.remove('so-grid-wrap');
    },
  };

  return controller;
}
