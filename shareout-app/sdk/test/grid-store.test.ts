import { describe, expect, it, vi } from 'vitest';
import { Grid } from '../src/stores/grid-store';
import type { SdkClient } from '../src/core/sdk-client';
import type { Table } from '../src/stores/table-store';
import type { SheetsStore } from '../src/stores/sheets-store';
import { TableSource } from '../src/grid/adapters/table';
import { SheetsSource } from '../src/grid/adapters/sheets';
import { inferColumns } from '../src/grid/infer-columns';
import { colToA1 } from '../src/grid/a1';

describe('colToA1', () => {
  it('maps zero-based index to spreadsheet columns', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(colToA1)).toEqual([
      'A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA',
    ]);
  });
});

describe('inferColumns', () => {
  it('infers types, humanizes titles, skips system fields', () => {
    const cols = inferColumns([
      { id: '1', sku: 'A1', qty: 5, active: true, due_date: '2026-01-02', createdAt: 'x', updatedAt: 'x' },
    ]);
    expect(cols).toEqual([
      { field: 'sku', title: 'Sku', type: 'text', editable: true },
      { field: 'qty', title: 'Qty', type: 'number', editable: true },
      { field: 'active', title: 'Active', type: 'boolean', editable: true },
      { field: 'due_date', title: 'Due Date', type: 'date', editable: true },
    ]);
  });

  it('keeps first-seen field order and uses first non-null value for type', () => {
    const cols = inferColumns([
      { id: '1', a: null },
      { id: '2', a: 7, b: 'x' },
    ]);
    expect(cols.map((c) => c.field)).toEqual(['a', 'b']);
    expect(cols[0].type).toBe('number');
  });
});

function fakeTable(rows: Array<{ id: string; [k: string]: unknown }>) {
  const calls: Record<string, unknown[]> = { updateById: [], insert: [], deleteById: [] };
  let lastQuery = { skip: 0, limit: 0 };
  const query = {
    skip(n: number) { lastQuery.skip = n; return query; },
    limit(n: number) { lastQuery.limit = n; return query; },
    async exec() { return rows.slice(lastQuery.skip, lastQuery.skip + lastQuery.limit); },
  };
  const table = {
    find: () => query,
    updateById: async (id: string, changes: unknown) => { calls.updateById.push({ id, changes }); return null; },
    insert: async (doc: unknown) => { calls.insert.push(doc); return { id: 'new', ...(doc as object) }; },
    deleteById: async (id: string) => { calls.deleteById.push(id); return true; },
  };
  return { table: table as unknown as Table<{ id: string }>, calls, lastQuery };
}

describe('TableSource', () => {
  it('probes hasMore and slices to page size', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: String(i) }));
    const { table, lastQuery } = fakeTable(rows);
    const src = new TableSource(table, 5);
    const result = await src.load({ offset: 0, limit: 5 });
    expect(lastQuery.limit).toBe(6); // limit + 1 probe
    expect(result.rows).toHaveLength(5);
    expect(result.hasMore).toBe(true);
  });

  it('reports hasMore=false when page not full', async () => {
    const { table } = fakeTable([{ id: '0' }, { id: '1' }]);
    const result = await new TableSource(table, 5).load();
    expect(result.hasMore).toBe(false);
    expect(result.rows).toHaveLength(2);
  });

  it('dispatches edits to table CRUD', async () => {
    const { table, calls } = fakeTable([]);
    const src = new TableSource(table, 5);
    await src.applyCellEdit('r1', 'qty', 9);
    await src.addRow({ sku: 'Z' });
    await src.deleteRow('r1');
    expect(calls.updateById).toEqual([{ id: 'r1', changes: { qty: 9 } }]);
    expect(calls.insert).toEqual([{ sku: 'Z' }]);
    expect(calls.deleteById).toEqual(['r1']);
  });
});

function fakeSheets() {
  const update = vi.fn(async () => ({ updated: true, updatedCells: 1, updatedRows: 1 }));
  const append = vi.fn(async () => ({ appended: true, appendedRows: 1, appendedCells: 1 }));
  const fetch = vi.fn(async () => ({
    data: [{ Name: 'Ann', Qty: 1 }, { Name: 'Bob', Qty: 2 }],
    headers: ['Name', 'Qty'],
    rowCount: 2,
  }));
  const sheets = { update, append, fetch, isConnected: async () => true };
  return { sheets: sheets as unknown as SheetsStore, update, append, fetch };
}

describe('SheetsSource', () => {
  it('loads rows with index ids and header columns', async () => {
    const { sheets } = fakeSheets();
    const src = new SheetsSource(sheets, { spreadsheetId: 'sid', range: 'A1:B' });
    const result = await src.load();
    expect(result.rows).toEqual([
      { id: '0', Name: 'Ann', Qty: 1 },
      { id: '1', Name: 'Bob', Qty: 2 },
    ]);
  });

  it('maps cell edit to A1 via header order, not visual order', async () => {
    const { sheets, update } = fakeSheets();
    const src = new SheetsSource(sheets, { spreadsheetId: 'sid', range: 'A1:B', sheetName: 'Sheet1' });
    await src.load();
    await src.applyCellEdit('1', 'Qty', 42); // Qty=col B(1), row index 1 → row 3
    expect(update).toHaveBeenCalledWith({
      spreadsheetId: 'sid',
      spreadsheetUrl: undefined,
      range: 'Sheet1!B3',
      values: [[42]],
    });
  });

  it('appends a new row in header order', async () => {
    const { sheets, append } = fakeSheets();
    const src = new SheetsSource(sheets, { spreadsheetId: 'sid', range: 'A1:B' });
    await src.load();
    await src.addRow({ Name: 'Cy', Qty: 3 });
    expect(append).toHaveBeenCalledWith({
      spreadsheetId: 'sid',
      spreadsheetUrl: undefined,
      range: 'A1:B',
      values: [['Cy', 3]],
    });
  });
});

describe('Grid', () => {
  function sdkWithTable(rows: Array<{ id: string; [k: string]: unknown }>) {
    const { table } = fakeTable(rows);
    return { table: () => table } as unknown as SdkClient;
  }

  it('uses explicit columns over inference', async () => {
    const grid = new Grid(sdkWithTable([{ id: '1', sku: 'A' }]), 'inv', {
      columns: [{ field: 'sku', title: 'Item', type: 'text' }],
    });
    const { columns } = await grid.load({ limit: 10 });
    expect(columns).toEqual([{ field: 'sku', title: 'Item', type: 'text' }]);
  });

  it('infers columns when none provided', async () => {
    const grid = new Grid(sdkWithTable([{ id: '1', sku: 'A', qty: 2 }]), 'inv', {});
    const { columns } = await grid.load({ limit: 10 });
    expect(columns.map((c) => c.field)).toEqual(['sku', 'qty']);
  });

  it('exports CSV with header titles and escaping', async () => {
    const grid = new Grid(sdkWithTable([{ id: '1', name: 'a,b', n: 1 }]), 'inv', { pageSize: 10 });
    const csv = await grid.exportCsv();
    expect(csv).toBe('Name,N\n"a,b",1');
  });

  it('render() requires a browser environment', async () => {
    const grid = new Grid(sdkWithTable([]), 'inv', {});
    await expect(grid.render('#app')).rejects.toThrow(/browser/);
  });
});
