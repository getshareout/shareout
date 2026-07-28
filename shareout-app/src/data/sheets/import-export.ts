import { DATA_ERRORS } from '../../types';
import { generateId } from '../../crypto-utils';
import { getSessionUser } from '../../auth';
import { createLogger, logError } from '../../logging';
import { successResponse, errorResponse, type DataContext } from '../middleware';
import { getValidAccessToken } from './google-auth';
import {
  getConnectionByName,
  updateConnectionAfterSync,
} from './connections';
import {
  parseSheetsApiThrownError,
  sheetsUpstreamFromStatus,
  userFacingSheetsUpstreamError,
} from './errors';
import { fetchSheetValues, putSheetValues } from './sheet-api';
import { updateSyncLog } from './sync-log';
import { formatValue, parseValue, sanitizeColumnName } from './utils';

function syncLogErrorMessage(err: unknown): string {
  const parsed = parseSheetsApiThrownError(err);
  if (parsed) {
    return `Google Sheets upstream HTTP ${parsed.status}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Sync failed';
}

async function handleSheetsSyncError(
  err: unknown,
  ctx: DataContext,
  operation: 'import' | 'export',
  logId: string,
  connectionName: string,
  spreadsheetId: string,
  range: string,
): Promise<Response> {
  const fallbackCode = operation === 'import' ? 'IMPORT_ERROR' : 'EXPORT_ERROR';
  const parsed = parseSheetsApiThrownError(err);
  const syncError = syncLogErrorMessage(err);
  await updateSyncLog(ctx.env, logId, 'failed', 0, syncError);

  if (parsed) {
    if (parsed.status === 401 || parsed.status === 403) {
      return errorResponse({
        code: 'SHEETS_ACCESS_DENIED',
        message: 'Access denied. Ensure the sheet is shared with the authorized account.',
        status: 403,
      });
    }

    const { code, httpStatus } = sheetsUpstreamFromStatus(parsed.status);
    logError(
      createLogger(ctx.env, {
        scope: 'sheets',
        event: `sheets.${operation}.upstream_failed`,
        artifact_id: ctx.artifactId,
        connection_name: connectionName,
        spreadsheet_id: spreadsheetId,
        range,
        code,
        upstream_status: parsed.status,
      }),
      `google sheets ${operation} upstream request failed`,
      new Error(parsed.body.slice(0, 500)),
    );
    return errorResponse({
      code,
      message: userFacingSheetsUpstreamError(code, parsed.status),
      status: httpStatus,
    });
  }

  logError(
    createLogger(ctx.env, {
      scope: 'sheets',
      event: `sheets.${operation}.failed`,
      artifact_id: ctx.artifactId,
      connection_name: connectionName,
      spreadsheet_id: spreadsheetId,
      range,
    }),
    `sheet data ${operation} failed`,
    err,
  );
  return errorResponse({
    code: fallbackCode,
    message: userFacingSheetsUpstreamError(fallbackCode),
    status: 500,
  });
}

async function requireUserGoogleToken(
  request: Request,
  ctx: DataContext,
  connectMessage: string
): Promise<{ accessToken: string } | Response> {
  const user = await getSessionUser(request, ctx.env);
  if (!user) {
    return errorResponse({ ...DATA_ERRORS.UNAUTHORIZED, message: 'Login required' });
  }

  const accessToken = await getValidAccessToken(ctx.env, user.id);
  if (!accessToken) {
    return errorResponse({
      code: 'GOOGLE_NOT_CONNECTED',
      message: connectMessage,
      status: 401,
    });
  }

  return { accessToken };
}

async function startSyncLog(
  ctx: DataContext,
  connectionId: string,
  direction: 'import' | 'export'
): Promise<string> {
  const logId = generateId('syl');
  const startedAt = new Date().toISOString();

  await ctx.env.DB.prepare(`
    INSERT INTO sheets_sync_log (id, connection_id, direction, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).bind(logId, connectionId, direction, startedAt).run();

  return logId;
}

export async function importFromSheet(
  request: Request,
  ctx: DataContext,
  connectionName: string
): Promise<Response> {
  const auth = await requireUserGoogleToken(
    request,
    ctx,
    'Google account not connected. Visit /sheets/connect first.'
  );
  if (auth instanceof Response) return auth;

  const conn = await getConnectionByName(ctx, connectionName);
  if (!conn) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: 'Connection not found' });
  }

  const logId = await startSyncLog(ctx, conn.id, 'import');

  try {
    const range = conn.sheet_name || 'Sheet1';
    const rows = await fetchSheetValues(auth.accessToken, conn.spreadsheet_id, range);

    if (rows.length < 1) {
      await updateSyncLog(ctx.env, logId, 'completed', 0);
      return successResponse({ imported: 0, message: 'Sheet is empty' });
    }

    const headers = rows[0].map(h => sanitizeColumnName(h));
    const dataRows = rows.slice(1);

    let table = await ctx.env.DB.prepare(
      'SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?'
    ).bind(ctx.artifactId, conn.target_table).first<{ id: string }>();

    if (!table) {
      const tableId = generateId('tbl');
      await ctx.env.DB.prepare(
        'INSERT INTO artifact_tables (id, artifact_id, name) VALUES (?, ?, ?)'
      ).bind(tableId, ctx.artifactId, conn.target_table).run();
      table = { id: tableId };
    }

    await ctx.env.DB.prepare(
      'DELETE FROM artifact_rows WHERE table_id = ?'
    ).bind(table.id).run();

    let importedCount = 0;
    const now = new Date().toISOString();

    for (const row of dataRows) {
      const rowData: Record<string, unknown> = {
        id: generateId('row'),
        createdAt: now,
        updatedAt: now,
      };

      headers.forEach((header, i) => {
        if (header && row[i] !== undefined) {
          rowData[header] = parseValue(row[i]);
        }
      });

      await ctx.env.DB.prepare(
        'INSERT INTO artifact_rows (id, table_id, data) VALUES (?, ?, ?)'
      ).bind(rowData.id, table.id, JSON.stringify(rowData)).run();

      importedCount++;
    }

    await ctx.env.DB.prepare(
      `UPDATE artifact_tables SET row_count = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).bind(importedCount, table.id).run();

    await updateConnectionAfterSync(ctx, conn.id, importedCount);
    await updateSyncLog(ctx.env, logId, 'completed', importedCount);

    return successResponse({
      imported: importedCount,
      targetTable: conn.target_table,
      columns: headers.filter(Boolean),
    });
  } catch (err) {
    const range = conn.sheet_name || 'Sheet1';
    return handleSheetsSyncError(
      err,
      ctx,
      'import',
      logId,
      connectionName,
      conn.spreadsheet_id,
      range,
    );
  }
}

export async function exportToSheet(
  request: Request,
  ctx: DataContext,
  connectionName: string
): Promise<Response> {
  const auth = await requireUserGoogleToken(
    request,
    ctx,
    'Google account not connected'
  );
  if (auth instanceof Response) return auth;

  const conn = await getConnectionByName(ctx, connectionName);
  if (!conn) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: 'Connection not found' });
  }

  const logId = await startSyncLog(ctx, conn.id, 'export');

  try {
    const table = await ctx.env.DB.prepare(
      'SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?'
    ).bind(ctx.artifactId, conn.target_table).first<{ id: string }>();

    if (!table) {
      await updateSyncLog(ctx.env, logId, 'completed', 0);
      return successResponse({ exported: 0, message: 'Table not found' });
    }

    const result = await ctx.env.DB.prepare(
      'SELECT data FROM artifact_rows WHERE table_id = ? ORDER BY created_at'
    ).bind(table.id).all<{ data: string }>();

    const rows = result.results.map(r => JSON.parse(r.data) as Record<string, unknown>);

    if (rows.length === 0) {
      await updateSyncLog(ctx.env, logId, 'completed', 0);
      return successResponse({ exported: 0, message: 'Table is empty' });
    }

    const allKeys = new Set<string>();
    rows.forEach(row => {
      Object.keys(row).forEach(key => {
        if (!['id', 'createdAt', 'updatedAt'].includes(key)) {
          allKeys.add(key);
        }
      });
    });
    const headers = Array.from(allKeys);

    const values: string[][] = [headers];
    rows.forEach(row => {
      values.push(headers.map(h => formatValue(row[h])));
    });

    const range = conn.sheet_name || 'Sheet1';
    await putSheetValues(auth.accessToken, conn.spreadsheet_id, range, values);

    const exportedCount = rows.length;
    await updateConnectionAfterSync(ctx, conn.id, exportedCount);
    await updateSyncLog(ctx.env, logId, 'completed', exportedCount);

    return successResponse({
      exported: exportedCount,
      spreadsheetId: conn.spreadsheet_id,
      columns: headers,
    });
  } catch (err) {
    const range = conn.sheet_name || 'Sheet1';
    return handleSheetsSyncError(
      err,
      ctx,
      'export',
      logId,
      connectionName,
      conn.spreadsheet_id,
      range,
    );
  }
}
