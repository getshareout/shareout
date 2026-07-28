import type { Table } from '../../stores/table-store';
import type { GridRow, GridSource, GridLoadResult } from '../types';

/**
 * Grid backed by a ShareOut table (sdk.table). Reuses the existing
 * /tables CRUD — no new server endpoint. Durable, queryable, 100k rows.
 */
export class TableSource implements GridSource {
  constructor(private table: Table<GridRow>, private pageSize = 100) {}

  async load(opts?: { offset?: number; limit?: number }): Promise<GridLoadResult> {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? this.pageSize;
    // Probe one past the page to learn hasMore without a COUNT(*) scan.
    const rows = await this.table.find().skip(offset).limit(limit + 1).exec();
    const hasMore = rows.length > limit;
    return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore };
  }

  async applyCellEdit(rowId: string, field: string, value: unknown): Promise<void> {
    await this.table.updateById(rowId, { [field]: value } as Partial<GridRow>);
  }

  async addRow(data: Record<string, unknown>): Promise<GridRow> {
    return this.table.insert(data as Omit<GridRow, 'id'>);
  }

  async deleteRow(rowId: string): Promise<void> {
    await this.table.deleteById(rowId);
  }
}
