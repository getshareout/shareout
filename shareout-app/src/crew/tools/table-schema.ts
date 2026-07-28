import { queryRowsForTool, listTableNames } from '../../data/tables';
import type { CrewTool } from '../types';

export const tableSchemaTool: CrewTool = {
  name: 'table_schema',
  mode: 'read',
  description:
    "Discover the app's data. Call with no table to list all tables; call with a table name to see its fields, inferred from a sample of rows.",
  input_schema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Optional table name. Omit to list all tables.' },
    },
  },
  async execute(ctx, input) {
    const table = typeof input.table === 'string' ? input.table : '';

    if (!table) {
      const tables = await listTableNames(ctx.data);
      return { tables };
    }

    const result = await queryRowsForTool(ctx.data, table, { limit: 20 });
    if ('error' in result) return result;

    const fields = new Map<string, string>();
    for (const row of result.rows) {
      for (const [key, value] of Object.entries(row)) {
        if (fields.has(key)) continue;
        const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        fields.set(key, type);
      }
    }

    return {
      table,
      total: result.total,
      fields: Array.from(fields, ([name, type]) => ({ name, type })),
    };
  },
};
