import { generateId } from '../../crypto-utils';
import { DATA_ERRORS } from '../../types';
import { errorResponse, successResponse, type DataContext } from '../middleware';
import { Errors } from '../errors';
import { MAX_TABLES_PER_ARTIFACT } from './constants';
import { validateTableName } from './validation';

/** List all tables for the current artifact. */
export async function listTables(ctx: DataContext): Promise<Response> {
  const result = await ctx.db.prepare(
    'SELECT name, row_count as rowCount FROM artifact_tables WHERE artifact_id = ? ORDER BY name',
  ).bind(ctx.artifactId).all<{ name: string; rowCount: number }>();

  return successResponse({ tables: result.results });
}

/** Table names + row counts for the current artifact (Crew schema tool). */
export async function listTableNames(
  ctx: DataContext,
): Promise<{ name: string; rowCount: number }[]> {
  const result = await ctx.db.prepare(
    'SELECT name, row_count as rowCount FROM artifact_tables WHERE artifact_id = ? ORDER BY name',
  ).bind(ctx.artifactId).all<{ name: string; rowCount: number }>();
  return result.results;
}

/**
 * Resolve or create a table by name (create-on-first-write for HTTP inserts).
 * Uses upsert so concurrent first-writes of the same name share one id.
 */
export async function getOrCreateTable(
  ctx: DataContext,
  name: string,
): Promise<{ id: string } | Response> {
  let table = await ctx.db.prepare(
    'SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?',
  ).bind(ctx.artifactId, name).first<{ id: string }>();

  if (!table) {
    const tableCount = await ctx.db.prepare(
      'SELECT COUNT(*) as count FROM artifact_tables WHERE artifact_id = ?',
    ).bind(ctx.artifactId).first<{ count: number }>();

    if (tableCount && tableCount.count >= MAX_TABLES_PER_ARTIFACT) {
      return errorResponse({
        ...DATA_ERRORS.TABLE_LIMIT_EXCEEDED,
        hint: `Current table count: ${tableCount.count}/${MAX_TABLES_PER_ARTIFACT}.`,
        suggestion: 'Delete unused tables with DELETE /tables/{name}?confirm=true.',
      }, ctx.origin);
    }

    const id = generateId('tbl');
    table = await ctx.db.prepare(
      'INSERT INTO artifact_tables (id, artifact_id, name) VALUES (?, ?, ?) ON CONFLICT(artifact_id, name) DO UPDATE SET name = excluded.name RETURNING id',
    ).bind(id, ctx.artifactId, name).first<{ id: string }>() as { id: string };
  }

  return table;
}

/**
 * Resolve an existing table by name (Telegram bot — never auto-creates).
 * Returns available table names when the target is missing.
 */
export async function resolveTable(
  ctx: DataContext,
  tableName: string,
): Promise<{ id: string } | { error: string; tables: string[] }> {
  const nameError = validateTableName(tableName);
  if (nameError) return { error: nameError, tables: [] };
  const table = await ctx.db.prepare(
    'SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?',
  ).bind(ctx.artifactId, tableName).first<{ id: string }>();
  if (table) return { id: table.id };
  const all = await ctx.db.prepare(
    'SELECT name FROM artifact_tables WHERE artifact_id = ? ORDER BY name',
  ).bind(ctx.artifactId).all<{ name: string }>();
  return { error: `Table "${tableName}" not found.`, tables: all.results.map((r) => r.name) };
}

/** Look up table id for export (404 when missing). */
export async function getTableId(
  ctx: DataContext,
  tableName: string,
): Promise<string | null> {
  const table = await ctx.db.prepare(
    'SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?',
  ).bind(ctx.artifactId, tableName).first<{ id: string }>();
  return table?.id ?? null;
}
