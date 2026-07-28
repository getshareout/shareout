import { queryRowsForTool, type QueryBody } from '../../data/tables';
import type { CrewTool } from '../types';

export const tableQueryTool: CrewTool = {
  name: 'table_query',
  mode: 'read',
  description:
    'Query rows from a data table in this app. Read-only. Returns matching rows and the total count.',
  input_schema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Name of the table to query.' },
      filter: {
        type: 'object',
        description:
          'Optional filter, e.g. {"status":"open"} or {"amount":{"$gt":100}}. Operators: $eq $ne $gt $gte $lt $lte $in $nin $contains $startsWith $endsWith.',
      },
      sort: { type: 'object', description: 'Optional sort, e.g. {"createdAt":"desc"}.' },
      limit: { type: 'number', description: 'Max rows to return.' },
      select: { type: 'array', items: { type: 'string' }, description: 'Optional list of fields to return.' },
    },
    required: ['table'],
  },
  async execute(ctx, input) {
    const table = typeof input.table === 'string' ? input.table : '';
    if (!table) return { error: 'Missing required field "table".' };

    const maxRows = ctx.limits.maxRows ?? 500;
    const requested = typeof input.limit === 'number' ? input.limit : maxRows;

    const body: QueryBody = {
      filter: input.filter as QueryBody['filter'],
      sort: input.sort as QueryBody['sort'],
      limit: Math.min(requested, maxRows),
      select: Array.isArray(input.select) ? (input.select as string[]) : undefined,
    };

    return queryRowsForTool(ctx.data, table, body);
  },
};
