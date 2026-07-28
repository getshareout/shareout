import type { SdkClient } from '../core/sdk-client';
import { SheetsStore } from './sheets-store';
import { TableSource } from '../grid/adapters/table';
import { SheetsSource } from '../grid/adapters/sheets';
import { inferColumns } from '../grid/infer-columns';
import type { GridColumn, GridOptions, GridRow, GridSource } from '../grid/types';

function buildSource(sdk: SdkClient, name: string, opts: GridOptions): GridSource {
  if (opts.source === 'sheets') {
    return new SheetsSource(new SheetsStore(sdk), {
      spreadsheetId: opts.spreadsheetId,
      spreadsheetUrl: opts.spreadsheetUrl,
      range: opts.range,
      sheetName: opts.sheetName,
    });
  }
  return new TableSource(sdk.table<GridRow>(name), opts.pageSize ?? 100);
}

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Editable spreadsheet grid bound to a ShareOut data source. The UI layer
 * (render) loads lazily in Phase 2; the data binding here is source-agnostic
 * via GridSource. See specs/editable-grid.md.
 */
export class Grid {
  private source: GridSource;
  private _columns?: GridColumn[];

  constructor(private sdk: SdkClient, private name: string, private opts: GridOptions = {}) {
    this.source = buildSource(sdk, name, opts);
  }

  /** Load a page of rows and resolve columns (explicit > inferred). */
  async load(range?: { offset?: number; limit?: number }): Promise<{
    rows: GridRow[];
    columns: GridColumn[];
    hasMore: boolean;
  }> {
    const result = await this.source.load(range);
    const editable = this.opts.editable ?? true;
    this._columns =
      this.opts.columns ?? result.columns ?? inferColumns(result.rows, editable);
    return { rows: result.rows, columns: this._columns, hasMore: result.hasMore };
  }

  get columns(): GridColumn[] | undefined {
    return this._columns;
  }

  setCell(rowId: string, field: string, value: unknown): Promise<void> {
    return this.source.applyCellEdit(rowId, field, value);
  }

  addRow(data: Record<string, unknown> = {}): Promise<GridRow> {
    return this.source.addRow(data);
  }

  deleteRow(rowId: string): Promise<void> {
    return this.source.deleteRow(rowId);
  }

  /** Serialize all loaded rows to CSV using the resolved column order. */
  async exportCsv(): Promise<string> {
    const { rows, columns } = await this.load();
    const header = columns.map((c) => csvCell(c.title)).join(',');
    const body = rows
      .map((row) => columns.map((c) => csvCell(row[c.field])).join(','))
      .join('\n');
    return `${header}\n${body}`;
  }

  /**
   * Mount the editable grid UI. The Tabulator bundle is lazy-loaded from
   * /sdk/grid.js on first call, so artifacts that never render a grid pay
   * zero bytes for it. Returns a controller ({ table, addRow, destroy }).
   */
  async render(target: string | HTMLElement): Promise<GridUiController> {
    if (typeof window === 'undefined') {
      throw new Error('grid.render() requires a browser environment');
    }
    // Variable specifier keeps the bundler from inlining the UI chunk into
    // the core SDK — it stays a runtime native dynamic import.
    const url = new URL('/sdk/grid.js', location.origin).href;
    const mod: { mountGrid: MountGrid } = await import(/* @vite-ignore */ url);
    this._controller = await mod.mountGrid(target, this, {
      editable: this.opts.editable ?? true,
      height: this.opts.height,
      pageSize: this.opts.pageSize,
    });
    return this._controller;
  }

  /** Tear down a mounted grid. */
  destroy(): void {
    this._controller?.destroy();
    this._controller = undefined;
  }

  private _controller?: GridUiController;
}

interface GridUiController {
  addRow(data?: Record<string, unknown>): Promise<void>;
  destroy(): void;
}

type MountGrid = (
  target: string | HTMLElement,
  grid: Grid,
  opts: { editable?: boolean; height?: string; pageSize?: number }
) => Promise<GridUiController>;
