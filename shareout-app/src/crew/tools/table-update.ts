import { updateRowsForTool } from '../../data/tables';
import type { CrewTool } from '../types';

export const tableUpdateTool: CrewTool = {
  name: 'table_update',
  mode: 'write',
  defaultApproval: 'whenPublic',
  description: 'Update rows matching a filter in a data table. A non-empty filter is required so you never update every row by accident.',
  input_schema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Name of the table to update.' },
      filter: {
        type: 'object',
        description: 'Which rows to update, e.g. {"status":"pending"} or {"amount":{"$lt":100}}. Must be non-empty.',
      },
      changes: { type: 'object', description: 'Fields to set on the matching rows.' },
    },
    required: ['table', 'filter', 'changes'],
  },
  async execute(ctx, input) {
    const table = typeof input.table === 'string' ? input.table : '';
    if (!table) return { error: 'Missing required field "table".' };
    const filter = input.filter && typeof input.filter === 'object' ? (input.filter as Record<string, unknown>) : {};
    const changes = input.changes && typeof input.changes === 'object' ? (input.changes as Record<string, unknown>) : {};
    if (!Object.keys(filter).length) return { error: 'Provide a non-empty "filter" (refusing to update all rows).' };
    if (!Object.keys(changes).length) return { error: 'Provide "changes" to apply.' };
    return updateRowsForTool(ctx.data, table, filter, changes);
  },
};
