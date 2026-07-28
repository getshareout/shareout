import type { AccountTool, ToolContext } from './types';
import type { DataContext } from '../../data/middleware';
import type { MiniDb } from '../../data/minidb-client';
import type { PendingAction } from '../actions';
import { resolveArtifactAccessForUser } from '../access';
import { buildBotDataContext } from '../data-write';

// Returning this halts the agent loop and shows the user a ✅/❌ confirmation —
// nothing is written until they tap Confirm (see actions.ts / chat-do.ts).
interface ActionProposal {
  __propose: PendingAction;
}
function propose(action: PendingAction): ActionProposal {
  return { __propose: action };
}

// Owner/editor gate shared by every data-write tool, mirroring editPageTool.
// Returns the bot DataContext on success, or an error object to relay verbatim.
async function gate(ctx: ToolContext, artifactId: string): Promise<{ dataCtx: DataContext } | { error: string }> {
  const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.userId);
  if (!access) return { error: 'You don’t have access to that page (or it doesn’t exist).' };
  if (access.role !== 'owner' && access.role !== 'editor') {
    return { error: 'Only the owner or an editor can change a page’s data.' };
  }
  const dataCtx = await buildBotDataContext(ctx.env, artifactId, access);
  if (!dataCtx) return { error: 'That page doesn’t exist.' };
  return { dataCtx };
}

export const addTableRowTool: AccountTool = {
  name: 'add_table_row',
  description:
    'Add a record (row) to one of a page’s data tables. Get the table name and its existing columns from read_artifact first, and shape `row` to match. Owner/editor only. Asks the user to confirm before the row is written.',
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      table: { type: 'string', description: 'The data table to add to (must already exist).' },
      row: { type: 'object', description: 'The record to add, as field/value pairs. Do not set id/createdAt/updatedAt — they are assigned automatically.' },
    },
    required: ['artifact_id', 'table', 'row'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    const table = typeof input.table === 'string' ? input.table.trim() : '';
    const row = input.row;
    if (!table) return { error: 'Tell me which table to add to.' };
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { error: 'Give me the row as an object of field/value pairs.' };

    const g = await gate(ctx, artifactId);
    if ('error' in g) return { error: g.error };

    const names = await tableNames(g.dataCtx, artifactId);
    if (!names.includes(table)) return { error: `Table "${table}" not found.`, available_tables: names };

    return propose({ kind: 'data_table_insert', artifactId, artifactName: g.dataCtx.artifact.name, table, row: row as Record<string, unknown> });
  },
};

export const updateTableRowTool: AccountTool = {
  name: 'update_table_row',
  description:
    'Change an existing record in a page’s data table — either one row by its id, or every row matching a filter. Use read_artifact / the query API to find the id or build the filter first. Provide exactly one of `row_id` or `filter`. Owner/editor only. Confirms before writing.',
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      table: { type: 'string' },
      row_id: { type: 'string', description: 'The id of a single row to update.' },
      filter: { type: 'object', description: 'A query filter selecting the rows to update (e.g. {"status":"open"}). Mutually exclusive with row_id.' },
      changes: { type: 'object', description: 'The fields to set, as field/value pairs.' },
    },
    required: ['artifact_id', 'table', 'changes'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    const table = typeof input.table === 'string' ? input.table.trim() : '';
    const rowId = typeof input.row_id === 'string' ? input.row_id.trim() : '';
    const filter = input.filter && typeof input.filter === 'object' && !Array.isArray(input.filter) ? (input.filter as Record<string, unknown>) : null;
    const changes = input.changes;
    if (!table) return { error: 'Tell me which table to update.' };
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return { error: 'Give me the changes as an object of field/value pairs.' };
    if (!rowId && !filter) return { error: 'Give me a row_id or a filter selecting which rows to update.' };
    if (rowId && filter) return { error: 'Give me either a row_id or a filter, not both.' };

    const g = await gate(ctx, artifactId);
    if ('error' in g) return { error: g.error };

    const names = await tableNames(g.dataCtx, artifactId);
    if (!names.includes(table)) return { error: `Table "${table}" not found.`, available_tables: names };

    return propose({
      kind: 'data_table_update',
      artifactId,
      artifactName: g.dataCtx.artifact.name,
      table,
      ...(rowId ? { rowId } : { filter: filter! }),
      changes: changes as Record<string, unknown>,
    });
  },
};

export const setJsonValueTool: AccountTool = {
  name: 'set_json_value',
  description:
    'Set a value in a page’s JSON store by key (good for single config-like values, not lists of records — use add_table_row for those). Owner/editor only. Confirms before writing.',
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      key: { type: 'string', description: 'The JSON-store key to set (letters, numbers, _, -, .).' },
      value: { description: 'The value to store (any JSON: object, array, string, number, boolean).' },
    },
    required: ['artifact_id', 'key', 'value'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    const key = typeof input.key === 'string' ? input.key.trim() : '';
    const value = input.value;
    if (!key) return { error: 'Tell me which key to set.' };
    if (value === undefined) return { error: 'Give me a value to store.' };

    const g = await gate(ctx, artifactId);
    if ('error' in g) return { error: g.error };
    if (g.dataCtx.viewerScope) return { error: 'This page has a row-level access policy; its JSON store is restricted.' };

    const existing = await g.dataCtx.db.prepare(
      'SELECT 1 FROM artifact_json WHERE artifact_id = ? AND key = ?'
    ).bind(artifactId, key).first();

    return propose({ kind: 'data_json_set', artifactId, artifactName: g.dataCtx.artifact.name, key, value, exists: !!existing });
  },
};

async function tableNames(dataCtx: { db: MiniDb }, artifactId: string): Promise<string[]> {
  const res = await dataCtx.db.prepare(
    'SELECT name FROM artifact_tables WHERE artifact_id = ? ORDER BY name'
  ).bind(artifactId).all<{ name: string }>();
  return res.results.map((r) => r.name);
}
