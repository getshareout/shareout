import { insertRowsForTool } from '../../data/tables';
import type { CrewTool } from '../types';

export const tableInsertTool: CrewTool = {
  name: 'table_insert',
  mode: 'write',
  defaultApproval: 'whenPublic',
  description: 'Insert one or more rows into a data table in this app.',
  input_schema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Name of the table to insert into.' },
      rows: {
        type: 'array',
        items: { type: 'object' },
        description: 'Array of row objects to insert.',
      },
    },
    required: ['table', 'rows'],
  },
  async execute(ctx, input) {
    const table = typeof input.table === 'string' ? input.table : '';
    if (!table) return { error: 'Missing required field "table".' };
    const rows = Array.isArray(input.rows) ? (input.rows as Record<string, unknown>[]) : [];
    if (!rows.length) return { error: 'Provide a non-empty "rows" array.' };
    const maxRows = ctx.limits.maxRows ?? 100;
    if (rows.length > maxRows) return { error: `Too many rows in one call (max ${maxRows}).` };
    return insertRowsForTool(ctx.data, table, rows);
  },
};
