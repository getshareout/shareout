/**
 * Artifact tables HTTP router — thin dispatcher over focused modules.
 *
 * Module layout (`src/data/tables/`):
 * - `types.ts` — QueryBody, Filter, QueryResult
 * - `constants.ts` — storage limits
 * - `validation.ts` — table name rules, JSON body parsing, field escaping
 * - `filter-sql.ts` — Mongo-style filter → SQLite json_extract SQL
 * - `scope.ts` — row-level access scope (0042)
 * - `meta.ts` — list/create/resolve table metadata
 * - `query.ts` — scoped query, count, distinct
 * - `crud.ts` — insert, read, update, delete, drop + Crew write tools
 * - `export.ts` — CSV export
 * - `materialize.ts` — env-based bulk write (datasets, cron)
 * - `bot.ts` — Telegram bot wrappers
 */
import { DATA_ERRORS } from '../../types';
import { errorResponse, type DataContext } from '../middleware';
import { Errors } from '../errors';
import {
  deleteRowById,
  deleteRows,
  dropTable,
  getRowById,
  insertRows,
  updateRowById,
  updateRows,
} from './crud';
import { exportTableCsv } from './export';
import { getOrCreateTable, getTableId, listTables } from './meta';
import { countRows, distinctValues, queryRows } from './query';
import type { Filter, QueryBody } from './types';
import { parseJsonBody, validateTableName } from './validation';
import { denyTableWrite } from './write-policy';

export { buildScopeClause } from './scope';
export { filterToSql } from './filter-sql';
export { queryRowsForTool } from './query';
export { listTableNames } from './meta';
export { insertRowsForTool, updateRowsForTool } from './crud';
export { writeTableRows } from './materialize';
export {
  botInsertRows,
  botUpdateRowById,
  botUpdateRowsByFilter,
} from './bot';
export type { QueryBody, Filter, QueryResult } from './types';

export async function handleTables(
  request: Request,
  ctx: DataContext,
  path: string,
): Promise<Response> {
  const parts = path.split('/').filter(Boolean);
  const tableName = parts[0];
  const thirdPart = parts[1];

  if (!tableName) {
    if (request.method === 'GET') {
      return listTables(ctx);
    }
    return errorResponse(Errors.missingParam('tableName', 'users'), ctx.origin);
  }

  const tableError = validateTableName(tableName);
  if (tableError) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_TABLE_NAME,
      message: tableError,
      hint: `"${tableName}" is not a valid table name.`,
    }, ctx.origin);
  }

  if (thirdPart === 'export' && request.method === 'GET') {
    const tableId = await getTableId(ctx, tableName);
    if (!tableId) {
      return errorResponse({
        ...DATA_ERRORS.NOT_FOUND,
        message: `Table "${tableName}" not found`,
        hint: 'Save data to the table before exporting.',
      }, ctx.origin);
    }
    return exportTableCsv(ctx, tableName, request);
  }

  const isAction = ['query', 'count', 'distinct'].includes(thirdPart);
  const rowId = isAction ? undefined : thirdPart;
  const action = isAction ? thirdPart : undefined;

  if (action) {
    if (request.method !== 'POST') {
      return errorResponse(Errors.methodNotAllowed(request.method, ['POST']), ctx.origin);
    }
    const body = await parseJsonBody(request, ctx.origin);
    if (body instanceof Response) return body;

    switch (action) {
      case 'query':
        return queryRows(ctx, tableName, body as QueryBody);
      case 'count':
        return countRows(ctx, tableName, body as { filter?: Filter });
      case 'distinct':
        return distinctValues(ctx, tableName, body as { field: string; filter?: Filter });
      default:
        return errorResponse({
          code: 'UNKNOWN_ACTION',
          message: `Unknown action "${action}"`,
          status: 400,
          hint: `"${action}" is not a valid table action.`,
          suggestion: 'Available actions: query, count, distinct.',
        }, ctx.origin);
    }
  }

  if (rowId) {
    switch (request.method) {
      case 'GET':
        return getRowById(ctx, tableName, rowId);
      case 'PATCH': {
        const denied = await denyTableWrite(ctx, tableName);
        if (denied) return errorResponse(denied, ctx.origin);
        const body = await parseJsonBody(request, ctx.origin);
        if (body instanceof Response) return body;
        return updateRowById(ctx, tableName, rowId, body);
      }
      case 'DELETE': {
        const denied = await denyTableWrite(ctx, tableName);
        if (denied) return errorResponse(denied, ctx.origin);
        return deleteRowById(ctx, tableName, rowId);
      }
      default:
        return errorResponse(Errors.methodNotAllowed(request.method, ['GET', 'PATCH', 'DELETE']), ctx.origin);
    }
  }

  switch (request.method) {
    case 'POST': {
      const denied = await denyTableWrite(ctx, tableName);
      if (denied) return errorResponse(denied, ctx.origin);
      const body = await parseJsonBody(request, ctx.origin);
      if (body instanceof Response) return body;
      const table = await getOrCreateTable(ctx, tableName);
      if (table instanceof Response) return table;
      return insertRows(ctx, table.id, body);
    }
    case 'PATCH': {
      const denied = await denyTableWrite(ctx, tableName);
      if (denied) return errorResponse(denied, ctx.origin);
      const body = await parseJsonBody(request, ctx.origin);
      if (body instanceof Response) return body;
      return updateRows(ctx, tableName, body as { filter: Filter; changes: Record<string, unknown> });
    }
    case 'DELETE': {
      const denied = await denyTableWrite(ctx, tableName);
      if (denied) return errorResponse(denied, ctx.origin);
      const url = new URL(request.url);
      if (url.searchParams.get('confirm') === 'true') {
        return dropTable(ctx, tableName);
      }
      const body = await parseJsonBody(request, ctx.origin);
      if (body instanceof Response) return body;
      return deleteRows(ctx, tableName, body as { filter: Filter });
    }
    default:
      return errorResponse(Errors.methodNotAllowed(request.method, ['POST', 'PATCH', 'DELETE']), ctx.origin);
  }
}
