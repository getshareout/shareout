import { DATA_ERRORS } from '../../types';
import { successResponse, errorResponse, verifyOwner, type DataContext } from '../middleware';
import { createLogger, logError } from '../../logging';
import { getArtifactAccessToken } from './artifact-tokens';
import { invalidateSheetCache } from './cache';
import {
  parseSheetsApiThrownError,
  sheetsUpstreamFromStatus,
  userFacingSheetsUpstreamError,
} from './errors';
import { appendSheetValues, putSheetValues } from './sheet-api';
import { resolveSpreadsheetId } from './utils';

const OWNER_WRITE_ERROR = {
  code: 'OWNER_REQUIRED',
  message: 'Only the artifact owner can write to Google Sheets.',
  status: 403,
} as const;

async function requireOwnerForWrite(request: Request, ctx: DataContext): Promise<Response | null> {
  const isOwner = await verifyOwner(request, ctx);
  if (!isOwner) {
    return errorResponse(OWNER_WRITE_ERROR);
  }
  return null;
}

async function requireArtifactToken(ctx: DataContext): Promise<string | Response> {
  const accessToken = await getArtifactAccessToken(ctx.env, ctx.artifactId);
  if (!accessToken) {
    return errorResponse({
      code: 'SHEETS_NOT_CONNECTED',
      message: 'Google Sheets not connected.',
      status: 401,
    });
  }
  return accessToken;
}

function handleSheetsWriteError(
  err: unknown,
  ctx: DataContext,
  operation: 'update' | 'append',
  spreadsheetId: string,
  range: string,
): Response {
  const fallbackCode = operation === 'update' ? 'UPDATE_ERROR' : 'APPEND_ERROR';
  const parsed = parseSheetsApiThrownError(err);

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

export async function updateSheetData(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const ownerError = await requireOwnerForWrite(request, ctx);
  if (ownerError) return ownerError;

  let body: {
    spreadsheetUrl?: string;
    spreadsheetId?: string;
    range: string;
    values: unknown[][];
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' });
  }

  const spreadsheetId = resolveSpreadsheetId(body);
  if (!spreadsheetId || !body.range || !body.values) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_REQUEST,
      message: 'Provide spreadsheetUrl/spreadsheetId, range, and values',
    });
  }

  const tokenOrError = await requireArtifactToken(ctx);
  if (tokenOrError instanceof Response) return tokenOrError;

  try {
    const result = await putSheetValues(
      tokenOrError,
      spreadsheetId,
      body.range,
      body.values
    );

    await invalidateSheetCache(ctx.env, ctx.artifactId, spreadsheetId);

    return successResponse({
      updated: true,
      updatedCells: result.updatedCells,
      updatedRows: result.updatedRows,
    });
  } catch (err) {
    return handleSheetsWriteError(err, ctx, 'update', spreadsheetId, body.range);
  }
}

export async function appendSheetData(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const ownerError = await requireOwnerForWrite(request, ctx);
  if (ownerError) return ownerError;

  let body: {
    spreadsheetUrl?: string;
    spreadsheetId?: string;
    range?: string;
    values: unknown[][];
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' });
  }

  const spreadsheetId = resolveSpreadsheetId(body);
  if (!spreadsheetId || !body.values) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_REQUEST,
      message: 'Provide spreadsheetUrl/spreadsheetId and values',
    });
  }

  const tokenOrError = await requireArtifactToken(ctx);
  if (tokenOrError instanceof Response) return tokenOrError;

  const range = body.range || 'Sheet1';

  try {
    const updates = await appendSheetValues(
      tokenOrError,
      spreadsheetId,
      range,
      body.values
    );

    await invalidateSheetCache(ctx.env, ctx.artifactId, spreadsheetId);

    return successResponse({
      appended: true,
      appendedRows: updates.updatedRows,
      appendedCells: updates.updatedCells,
    });
  } catch (err) {
    return handleSheetsWriteError(err, ctx, 'append', spreadsheetId, range);
  }
}
