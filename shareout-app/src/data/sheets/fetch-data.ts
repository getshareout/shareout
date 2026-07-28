import { DATA_ERRORS } from '../../types';
import { successResponse, errorResponse, type DataContext } from '../middleware';
import { createLogger, logError } from '../../logging';
import { SHEETS_API } from './constants';
import { getArtifactAccessToken } from './artifact-tokens';
import { cacheSheetData, getCachedSheetData, makeCacheKey } from './cache';
import { sheetsUpstreamFromStatus, userFacingSheetsUpstreamError } from './errors';
import { resolveSpreadsheetId, rowsToObjects } from './utils';

export async function fetchSheetData(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  let body: {
    spreadsheetUrl?: string;
    spreadsheetId?: string;
    range?: string;
    headers?: boolean;
    cache?: boolean;
    forceRefresh?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' });
  }

  const spreadsheetId = resolveSpreadsheetId(body);
  if (!spreadsheetId) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_REQUEST,
      message: 'Provide spreadsheetUrl or spreadsheetId',
    });
  }

  const range = body.range || 'Sheet1';
  const cacheKey = makeCacheKey(spreadsheetId, range);
  const useCache = body.cache !== false;

  if (useCache && !body.forceRefresh) {
    const cached = await getCachedSheetData(ctx.env, ctx.artifactId, cacheKey);
    if (cached) {
      return successResponse({
        ...(cached.data as Record<string, unknown>),
        cached: true,
        cachedAt: cached.cachedAt,
      });
    }
  }

  const accessToken = await getArtifactAccessToken(ctx.env, ctx.artifactId);
  if (!accessToken) {
    return errorResponse({
      code: 'SHEETS_NOT_CONNECTED',
      message: 'Google Sheets not connected. Get auth URL from /sheets/auth-url first.',
      status: 401,
    });
  }

  try {
    const sheetsUrl = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    const sheetsResponse = await fetch(sheetsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!sheetsResponse.ok) {
      const error = await sheetsResponse.text();
      if (sheetsResponse.status === 401 || sheetsResponse.status === 403) {
        return errorResponse({
          code: 'SHEETS_ACCESS_DENIED',
          message: 'Access denied. Ensure the sheet is shared with the authorized account.',
          status: 403,
        });
      }
      // Other upstream failures are Google's, not ours — map to accurate codes so
      // a deleted sheet / bad range (4xx) or a rate-limit/Google outage (429/5xx)
      // does not surface as our own 500 and trip the 5xx self-health alert.
      const { code, httpStatus: status } = sheetsUpstreamFromStatus(sheetsResponse.status);
      logError(
        createLogger(ctx.env, {
          scope: 'sheets',
          event: 'sheets.fetch.upstream_failed',
          artifact_id: ctx.artifactId,
          spreadsheet_id: spreadsheetId,
          range,
          code,
          upstream_status: sheetsResponse.status,
        }),
        'google sheets upstream request failed',
        new Error(error.slice(0, 500)),
      );
      return errorResponse({
        code,
        message: userFacingSheetsUpstreamError(code, sheetsResponse.status),
        status,
      });
    }

    const data = await sheetsResponse.json() as { values?: string[][] };
    const rows = data.values || [];

    let result: { data: unknown[]; headers?: string[]; rowCount: number };

    if (rows.length === 0) {
      result = { data: [], headers: [], rowCount: 0 };
    } else if (body.headers !== false && rows.length > 1) {
      const mapped = rowsToObjects(rows);
      result = { data: mapped.data, headers: mapped.headers, rowCount: mapped.data.length };
    } else {
      result = { data: rows, rowCount: rows.length };
    }

    if (useCache) {
      await cacheSheetData(ctx.env, ctx.artifactId, cacheKey, result);
    }

    return successResponse({ ...result, cached: false });
  } catch (err) {
    logError(
      createLogger(ctx.env, {
        scope: 'sheets',
        event: 'sheets.fetch.failed',
        artifact_id: ctx.artifactId,
        spreadsheet_id: spreadsheetId,
        range,
      }),
      'sheet data fetch failed',
      err,
    );
    return errorResponse({
      code: 'FETCH_ERROR',
      message: userFacingSheetsUpstreamError('FETCH_ERROR'),
      status: 500,
    });
  }
}
