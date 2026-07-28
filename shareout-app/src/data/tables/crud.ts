import { generateId } from '../../crypto-utils';
import { DATA_ERRORS } from '../../types';
import { errorResponse, successResponse, type DataContext } from '../middleware';
import { Errors } from '../errors';
import { MAX_ROW_SIZE, MAX_ROWS_PER_TABLE } from './constants';
import { filterToSql } from './filter-sql';
import { getOrCreateTable } from './meta';
import { scopeClause } from './scope';
import type { Filter } from './types';

/** Wake crew triggers on row insert. Dynamic import avoids tables ↔ crew cycle. */
function fireCrewRowInsertedEvent(ctx: DataContext): void {
  const run = import('../../crew/triggers')
    .then((m) => m.emitCrewEvent(ctx.env, ctx.artifactId, 'table.row.inserted'))
    .catch(() => {});
  if (ctx.waitUntil) ctx.waitUntil(run);
  else void run;
}

export async function insertRows(
  ctx: DataContext,
  tableId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [body];
  const inserted: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  const currentCount = await ctx.db.prepare(
    'SELECT row_count FROM artifact_tables WHERE id = ?',
  ).bind(tableId).first<{ row_count: number }>();

  if (currentCount && currentCount.row_count + rows.length > MAX_ROWS_PER_TABLE) {
    return errorResponse({
      ...DATA_ERRORS.ROW_LIMIT_EXCEEDED,
      hint: `Current: ${currentCount.row_count} rows. Adding ${rows.length} would exceed ${MAX_ROWS_PER_TABLE} limit.`,
      suggestion: 'Delete old rows with DELETE /tables/{name} + filter, or archive to a dataset.',
    }, ctx.origin);
  }

  const statements: { sql: string; bindings: unknown[]; mode: 'run' }[] = [];
  for (const row of rows) {
    const id = generateId('row');
    const data = { id, ...row, createdAt: now, updatedAt: now };
    const jsonData = JSON.stringify(data);
    const rowSize = new TextEncoder().encode(jsonData).length;

    if (rowSize > MAX_ROW_SIZE) {
      return errorResponse({
        ...DATA_ERRORS.ROW_TOO_LARGE,
        hint: `Row size: ${(rowSize / 1000).toFixed(1)}KB exceeds ${MAX_ROW_SIZE / 1000}KB limit.`,
        suggestion: 'Store large content in blobs and reference by ID.',
      }, ctx.origin);
    }

    statements.push({
      sql: 'INSERT INTO artifact_rows (id, table_id, data) VALUES (?, ?, ?)',
      bindings: [id, tableId, jsonData],
      mode: 'run',
    });
    inserted.push(data);
  }

  statements.push({
    sql: `UPDATE artifact_tables SET row_count = row_count + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    bindings: [rows.length, tableId],
    mode: 'run',
  });

  await ctx.db.batch(statements);

  if (inserted.length > 0) fireCrewRowInsertedEvent(ctx);

  return successResponse({ inserted, count: inserted.length }, 201);
}

export async function getRowById(
  ctx: DataContext,
  tableName: string,
  rowId: string,
): Promise<Response> {
  const scope = scopeClause(ctx);
  const row = await ctx.db.prepare(
    `SELECT r.data FROM artifact_rows r JOIN artifact_tables t ON t.id = r.table_id WHERE t.artifact_id = ? AND t.name = ? AND r.id = ? AND ${scope.sql}`,
  ).bind(ctx.artifactId, tableName, rowId, ...scope.params).first<{ data: string }>();

  if (!row) {
    return errorResponse({
      ...DATA_ERRORS.ROW_NOT_FOUND,
      hint: `No row found with ID "${rowId}".`,
      suggestion: 'Use POST /tables/{name}/query to search for rows by field values.',
    }, ctx.origin);
  }

  return successResponse(JSON.parse(row.data));
}

export async function updateRowById(
  ctx: DataContext,
  tableName: string,
  rowId: string,
  changes: Record<string, unknown>,
): Promise<Response> {
  const scope = scopeClause(ctx);
  const existing = await ctx.db.prepare(
    `SELECT r.data FROM artifact_rows r JOIN artifact_tables t ON t.id = r.table_id WHERE t.artifact_id = ? AND t.name = ? AND r.id = ? AND ${scope.sql}`,
  ).bind(ctx.artifactId, tableName, rowId, ...scope.params).first<{ data: string }>();

  if (!existing) {
    return errorResponse({
      ...DATA_ERRORS.ROW_NOT_FOUND,
      hint: `No row found with ID "${rowId}".`,
      suggestion: 'Use POST /tables/{name}/query to find the correct row ID.',
    }, ctx.origin);
  }

  const data = JSON.parse(existing.data);
  const updated = { ...data, ...changes, updatedAt: new Date().toISOString() };
  delete updated.id;
  delete updated.createdAt;
  const finalData = { id: data.id, createdAt: data.createdAt, ...updated };

  const jsonData = JSON.stringify(finalData);
  const rowSize = new TextEncoder().encode(jsonData).length;
  if (rowSize > MAX_ROW_SIZE) {
    return errorResponse({
      ...DATA_ERRORS.ROW_TOO_LARGE,
      hint: `Updated row size: ${(rowSize / 1000).toFixed(1)}KB exceeds ${MAX_ROW_SIZE / 1000}KB limit.`,
      suggestion: 'Reduce data size or store large content in blobs.',
    }, ctx.origin);
  }

  await ctx.db.prepare(
    `UPDATE artifact_rows SET data = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  ).bind(jsonData, rowId).run();

  return successResponse(finalData);
}

export async function updateRows(
  ctx: DataContext,
  tableName: string,
  body: { filter: Filter; changes: Record<string, unknown> },
): Promise<Response> {
  const { filter, changes } = body;
  const { sql: whereSql, params: whereParams } = filterToSql(filter);
  const scope = scopeClause(ctx);

  const result = await ctx.db.prepare(
    `SELECT r.id, r.data FROM artifact_rows r JOIN artifact_tables t ON t.id = r.table_id WHERE t.artifact_id = ? AND t.name = ? AND ${whereSql} AND ${scope.sql}`,
  ).bind(ctx.artifactId, tableName, ...whereParams, ...scope.params).all<{ id: string; data: string }>();

  const now = new Date().toISOString();
  const statements: { sql: string; bindings: unknown[]; mode: 'run' }[] = [];

  for (const row of result.results) {
    const data = JSON.parse(row.data);
    const merged = { ...data, ...changes, updatedAt: now };
    delete merged.id;
    delete merged.createdAt;
    const finalData = { id: data.id, createdAt: data.createdAt, ...merged };

    const jsonData = JSON.stringify(finalData);
    const rowSize = new TextEncoder().encode(jsonData).length;
    if (rowSize > MAX_ROW_SIZE) {
      return errorResponse({
        ...DATA_ERRORS.ROW_TOO_LARGE,
        hint: `Updated row size: ${(rowSize / 1000).toFixed(1)}KB exceeds ${MAX_ROW_SIZE / 1000}KB limit.`,
        suggestion: 'Reduce data size or store large content in blobs.',
      }, ctx.origin);
    }

    statements.push({
      sql: `UPDATE artifact_rows SET data = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      bindings: [jsonData, row.id],
      mode: 'run',
    });
  }

  if (statements.length > 0) await ctx.db.batch(statements);

  return successResponse({ updated: statements.length });
}

export async function deleteRowById(
  ctx: DataContext,
  tableName: string,
  rowId: string,
): Promise<Response> {
  const scope = scopeClause(ctx);
  const result = await ctx.db.prepare(
    `DELETE FROM artifact_rows WHERE table_id = (SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?) AND id = ? AND ${scope.sql} RETURNING id`,
  ).bind(ctx.artifactId, tableName, rowId, ...scope.params).first();

  if (!result) {
    return errorResponse({
      ...DATA_ERRORS.ROW_NOT_FOUND,
      hint: `No row found with ID "${rowId}" or it was already deleted.`,
      suggestion: 'Use POST /tables/{name}/query to verify the row exists.',
    }, ctx.origin);
  }

  await ctx.db.prepare(
    `UPDATE artifact_tables SET row_count = row_count - 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE artifact_id = ? AND name = ?`,
  ).bind(ctx.artifactId, tableName).run();

  return successResponse({ deleted: true });
}

export async function deleteRows(
  ctx: DataContext,
  tableName: string,
  body: { filter: Filter },
): Promise<Response> {
  const { filter } = body;
  const { sql: whereSql, params: whereParams } = filterToSql(filter);
  const scope = scopeClause(ctx);

  const result = await ctx.db.prepare(
    `DELETE FROM artifact_rows WHERE table_id = (SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?) AND ${whereSql} AND ${scope.sql}`,
  ).bind(ctx.artifactId, tableName, ...whereParams, ...scope.params).run();

  const deleted = result.meta.changes || 0;

  await ctx.db.prepare(
    `UPDATE artifact_tables SET row_count = row_count - ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE artifact_id = ? AND name = ?`,
  ).bind(deleted, ctx.artifactId, tableName).run();

  return successResponse({ deleted });
}

export async function dropTable(ctx: DataContext, tableName: string): Promise<Response> {
  if (ctx.viewerScope) {
    return errorResponse(
      Errors.forbidden(
        'drop a table',
        'Your access is limited to specific rows; dropping the whole table is not allowed. Delete your rows with a filter instead.',
      ),
      ctx.origin,
    );
  }

  const table = await ctx.db.prepare(
    'SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?',
  ).bind(ctx.artifactId, tableName).first<{ id: string }>();

  if (!table) return successResponse({ dropped: true, rowsDeleted: 0 });

  const countResult = await ctx.db.prepare(
    'SELECT COUNT(*) as count FROM artifact_rows WHERE table_id = ?',
  ).bind(table.id).first<{ count: number }>();

  await ctx.db.prepare('DELETE FROM artifact_rows WHERE table_id = ?').bind(table.id).run();
  await ctx.db.prepare('DELETE FROM artifact_tables WHERE id = ?').bind(table.id).run();

  return successResponse({ dropped: true, rowsDeleted: countResult?.count || 0 });
}

/** Crew insert — no crew event (loop guard). */
export async function insertRowsForTool(
  ctx: DataContext,
  tableName: string,
  rows: Record<string, unknown>[],
): Promise<{ inserted: Record<string, unknown>[]; count: number } | { error: string }> {
  const table = await getOrCreateTable(ctx, tableName);
  if (table instanceof Response) return { error: `Could not access table "${tableName}"` };

  const currentCount = await ctx.db
    .prepare('SELECT row_count FROM artifact_tables WHERE id = ?')
    .bind(table.id)
    .first<{ row_count: number }>();
  if (currentCount && currentCount.row_count + rows.length > MAX_ROWS_PER_TABLE) {
    return { error: `Row limit exceeded (max ${MAX_ROWS_PER_TABLE} per table)` };
  }

  const inserted: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  const statements: { sql: string; bindings: unknown[]; mode: 'run' }[] = [];
  for (const row of rows) {
    const id = generateId('row');
    const data = { id, ...row, createdAt: now, updatedAt: now };
    const jsonData = JSON.stringify(data);
    if (new TextEncoder().encode(jsonData).length > MAX_ROW_SIZE) {
      return { error: `Row exceeds ${MAX_ROW_SIZE / 1000}KB limit` };
    }
    statements.push({
      sql: 'INSERT INTO artifact_rows (id, table_id, data) VALUES (?, ?, ?)',
      bindings: [id, table.id, jsonData],
      mode: 'run',
    });
    inserted.push(data);
  }

  statements.push({
    sql: `UPDATE artifact_tables SET row_count = row_count + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    bindings: [rows.length, table.id],
    mode: 'run',
  });

  await ctx.db.batch(statements);

  return { inserted, count: inserted.length };
}

/** Crew bulk update — same scope enforcement as HTTP path. */
export async function updateRowsForTool(
  ctx: DataContext,
  tableName: string,
  filter: Filter,
  changes: Record<string, unknown>,
): Promise<{ updated: number } | { error: string }> {
  const table = await ctx.db
    .prepare('SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?')
    .bind(ctx.artifactId, tableName)
    .first<{ id: string }>();
  if (!table) return { error: `Table "${tableName}" not found` };

  const { sql: whereSql, params: whereParams } = filterToSql(filter || {});
  const scope = scopeClause(ctx);

  const result = await ctx.db
    .prepare(`SELECT id, data FROM artifact_rows WHERE table_id = ? AND ${whereSql} AND ${scope.sql}`)
    .bind(table.id, ...whereParams, ...scope.params)
    .all<{ id: string; data: string }>();

  const now = new Date().toISOString();
  const statements: { sql: string; bindings: unknown[]; mode: 'run' }[] = [];
  for (const row of result.results) {
    const data = JSON.parse(row.data);
    const next = { ...data, ...changes, updatedAt: now };
    delete next.id;
    delete next.createdAt;
    const finalData = { id: data.id, createdAt: data.createdAt, ...next };
    statements.push({
      sql: `UPDATE artifact_rows SET data = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      bindings: [JSON.stringify(finalData), row.id],
      mode: 'run',
    });
  }

  if (statements.length > 0) await ctx.db.batch(statements);

  return { updated: statements.length };
}
