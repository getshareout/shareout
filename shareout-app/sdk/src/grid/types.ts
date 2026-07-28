export type GridColumnType = 'text' | 'number' | 'boolean' | 'date';

export interface GridColumn {
  field: string;
  title: string;
  type: GridColumnType;
  editable?: boolean;
  /** Fixed column width in px. Overrides widthGrow when set. */
  width?: number;
  /** Relative share of leftover width (Tabulator fitColumns). Default: text=3, else 1. */
  widthGrow?: number;
}

export type GridRow = { id: string; [key: string]: unknown };

export interface GridLoadResult {
  rows: GridRow[];
  columns?: GridColumn[];
  hasMore: boolean;
}

/**
 * Backend-agnostic data binding for the grid. Table, Sheets, and (later)
 * a realtime Y.js source all implement this so the author-facing API in
 * grid-store.ts never changes when the backend does.
 */
export interface GridSource {
  load(opts?: { offset?: number; limit?: number }): Promise<GridLoadResult>;
  applyCellEdit(rowId: string, field: string, value: unknown): Promise<void>;
  addRow(data: Record<string, unknown>): Promise<GridRow>;
  deleteRow(rowId: string): Promise<void>;
}

export interface GridOptions {
  source?: 'table' | 'sheets';
  columns?: GridColumn[];
  editable?: boolean;
  pageSize?: number;
  height?: string;
  // Sheets source
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  range?: string;
  sheetName?: string;
  // Reserved — no-op in v1 (see specs/editable-grid.md §8).
  realtime?: boolean;
}
