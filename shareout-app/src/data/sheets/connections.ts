import { DATA_ERRORS } from '../../types';
import { generateId } from '../../crypto-utils';
import { successResponse, errorResponse, type DataContext } from '../middleware';
import { NAME_PATTERN } from './constants';
import type { SheetConnection, SheetConnectionSummary } from './types';

function toSummary(conn: SheetConnection): SheetConnectionSummary {
  return {
    name: conn.name,
    spreadsheetId: conn.spreadsheet_id,
    sheetName: conn.sheet_name,
    targetTable: conn.target_table,
    syncDirection: conn.sync_direction,
    syncSchedule: conn.sync_schedule,
    lastSyncedAt: conn.last_synced_at,
    rowCount: conn.row_count,
    createdAt: conn.created_at,
  };
}

function toDetail(conn: SheetConnection) {
  return {
    ...toSummary(conn),
    updatedAt: conn.updated_at,
  };
}

export async function getConnectionByName(
  ctx: DataContext,
  name: string
): Promise<SheetConnection | null> {
  return ctx.env.DB.prepare(`
    SELECT * FROM sheet_syncs WHERE artifact_id = ? AND name = ?
  `).bind(ctx.artifactId, name).first<SheetConnection>();
}

export async function listSheetConnections(ctx: DataContext): Promise<Response> {
  const result = await ctx.env.DB.prepare(`
    SELECT name, spreadsheet_id, sheet_name, target_table, sync_direction,
           sync_schedule, last_synced_at, row_count, created_at
    FROM sheet_syncs
    WHERE artifact_id = ?
    ORDER BY name
  `).bind(ctx.artifactId).all<SheetConnection>();

  return successResponse({
    connections: result.results.map(toSummary),
    count: result.results.length,
  });
}

export async function createSheetConnection(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  let body: {
    name: string;
    spreadsheetId: string;
    sheetName?: string;
    targetTable: string;
    syncDirection?: 'import' | 'export' | 'bidirectional';
    syncSchedule?: string;
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' });
  }

  const { name, spreadsheetId, sheetName, targetTable, syncDirection, syncSchedule } = body;

  if (!name || !NAME_PATTERN.test(name)) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid name' });
  }

  if (!spreadsheetId) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'spreadsheetId required' });
  }

  if (!targetTable || !NAME_PATTERN.test(targetTable)) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid targetTable' });
  }

  const existing = await ctx.env.DB.prepare(
    'SELECT id FROM sheet_syncs WHERE artifact_id = ? AND name = ?'
  ).bind(ctx.artifactId, name).first();

  if (existing) {
    return errorResponse({ ...DATA_ERRORS.CONFLICT, message: 'Connection already exists' });
  }

  const id = generateId('gsc');
  const now = new Date().toISOString();

  await ctx.env.DB.prepare(`
    INSERT INTO sheet_syncs
    (id, artifact_id, name, spreadsheet_id, sheet_name, target_table, sync_direction, sync_schedule, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, ctx.artifactId, name, spreadsheetId, sheetName || null,
    targetTable, syncDirection || 'import', syncSchedule || null, now, now
  ).run();

  return successResponse({
    name,
    spreadsheetId,
    sheetName,
    targetTable,
    syncDirection: syncDirection || 'import',
    createdAt: now,
  }, 201);
}

export async function getSheetConnection(
  ctx: DataContext,
  name: string
): Promise<Response> {
  const conn = await getConnectionByName(ctx, name);

  if (!conn) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: 'Connection not found' });
  }

  return successResponse(toDetail(conn));
}

export async function deleteSheetConnection(
  ctx: DataContext,
  name: string
): Promise<Response> {
  const result = await ctx.env.DB.prepare(
    'DELETE FROM sheet_syncs WHERE artifact_id = ? AND name = ? RETURNING id'
  ).bind(ctx.artifactId, name).first();

  if (!result) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: 'Connection not found' });
  }

  return successResponse({ deleted: true });
}

export async function updateConnectionAfterSync(
  ctx: DataContext,
  connectionId: string,
  rowCount: number
): Promise<void> {
  await ctx.env.DB.prepare(`
    UPDATE sheet_syncs
    SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), row_count = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).bind(rowCount, connectionId).run();
}
