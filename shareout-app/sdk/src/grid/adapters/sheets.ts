import type { SheetsStore } from '../../stores/sheets-store';
import { colToA1 } from '../a1';
import type { GridRow, GridSource, GridLoadResult } from '../types';

interface SheetsTarget {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  range?: string;
  sheetName?: string;
}

/**
 * Grid backed by a connected Google Sheet, reusing the existing sheets
 * connector (read fetch + write update/append + artifact OAuth).
 *
 * Row ids are the zero-based data-row index. Cell writes map field → A1
 * via the fetched header order — NOT the grid's visual order — so column
 * reordering can't corrupt write-back. Last-writer-wins; no diff/merge
 * sync engine (see specs/editable-grid.md §5).
 */
export class SheetsSource implements GridSource {
  private headers: string[] = [];

  constructor(private sheets: SheetsStore, private target: SheetsTarget) {}

  async isConnected(): Promise<boolean> {
    return this.sheets.isConnected();
  }

  async load(): Promise<GridLoadResult> {
    const { spreadsheetId, spreadsheetUrl, range } = this.target;
    const result = await this.sheets.fetch<Record<string, unknown>>({
      spreadsheetId,
      spreadsheetUrl,
      range,
      headers: true,
    });
    this.headers = result.headers ?? Object.keys(result.data[0] ?? {});
    const rows: GridRow[] = result.data.map((r, i) => ({ id: String(i), ...r }));
    return { rows, hasMore: false };
  }

  // Data rows start at sheet row 2 (row 1 = header).
  private cellRange(rowId: string, field: string): string {
    const col = this.headers.indexOf(field);
    if (col < 0) throw new Error(`Unknown column "${field}"`);
    const rowNum = Number(rowId) + 2;
    const a1 = `${colToA1(col)}${rowNum}`;
    return this.target.sheetName ? `${this.target.sheetName}!${a1}` : a1;
  }

  async applyCellEdit(rowId: string, field: string, value: unknown): Promise<void> {
    await this.sheets.update({
      spreadsheetId: this.target.spreadsheetId,
      spreadsheetUrl: this.target.spreadsheetUrl,
      range: this.cellRange(rowId, field),
      values: [[value]],
    });
  }

  async addRow(data: Record<string, unknown>): Promise<GridRow> {
    const values = this.headers.map((h) => data[h] ?? '');
    await this.sheets.append({
      spreadsheetId: this.target.spreadsheetId,
      spreadsheetUrl: this.target.spreadsheetUrl,
      range: this.target.range,
      values: [values],
    });
    return { id: '-1', ...data };
  }

  // One-way limitation: clears the row's cells rather than structurally
  // removing it. Reload to resync indices.
  async deleteRow(rowId: string): Promise<void> {
    const rowNum = Number(rowId) + 2;
    const last = colToA1(Math.max(this.headers.length - 1, 0));
    const a1 = `A${rowNum}:${last}${rowNum}`;
    await this.sheets.update({
      spreadsheetId: this.target.spreadsheetId,
      spreadsheetUrl: this.target.spreadsheetUrl,
      range: this.target.sheetName ? `${this.target.sheetName}!${a1}` : a1,
      values: [this.headers.map(() => '')],
    });
  }
}
