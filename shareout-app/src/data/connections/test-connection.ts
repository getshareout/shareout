/**
 * Connection health-check handler (`POST …/connections/{name}/test`).
 */
import { DATA_ERRORS } from '../../types';
import {
  successResponse,
  errorResponse,
  resolveRequesterUserId,
  type DataContext,
} from '../middleware';
import { fetchWithTimeout, FetchTimeoutError } from '../../fetch-utils';
import { createLogger, logError } from '../../logging';
import { executeWarehouseQuery } from './warehouse-exec';
import {
  resolveGenericConnection,
  resolveConnectionCredentials,
} from './resolve';
import { staticHeaders } from './rest-query';
import { CONNECTION_TIMEOUT_MS } from './types';

export async function testConnection(
  request: Request,
  ctx: DataContext,
  name: string,
): Promise<Response> {
  if (!ctx.env.CREDENTIALS_KEY) {
    return errorResponse({
      code: 'CONFIG_ERROR',
      message: 'CREDENTIALS_KEY not configured',
      status: 500,
    });
  }

  const conn = await resolveGenericConnection(ctx.env, ctx.artifactId, name);

  if (!conn) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: 'Connection not found' });
  }

  try {
    const userId = await resolveRequesterUserId(request, ctx);
    const { credentials, credType } = await resolveConnectionCredentials(ctx.env, conn, userId);
    const config = JSON.parse(conn.config);

    if (conn.type === 'rest_api') {
      const baseUrl = config.baseUrl as string;
      if (!baseUrl) {
        return successResponse({ success: false, error: 'baseUrl not configured' });
      }

      const testUrl = config.healthEndpoint ? `${baseUrl}${config.healthEndpoint}` : baseUrl;
      const headers: Record<string, string> = { ...staticHeaders(config) };

      if (credType === 'api_key' && credentials) {
        const headerName = (config.apiKeyHeader as string) || 'Authorization';
        const prefix = (config.apiKeyPrefix as string | undefined) ?? 'Bearer ';
        headers[headerName] = `${prefix}${credentials.apiKey}`;
      } else if (credType === 'basic_auth' && credentials) {
        const auth = btoa(`${credentials.username}:${credentials.password}`);
        headers['Authorization'] = `Basic ${auth}`;
      }

      const response = await fetchWithTimeout(testUrl, { headers, method: 'GET' }, CONNECTION_TIMEOUT_MS);

      return successResponse({
        success: response.ok,
        status: response.status,
        message: response.ok ? 'Connection successful' : `HTTP ${response.status}`,
      });
    }

    if (conn.type === 'snowflake' || conn.type === 'bigquery') {
      await executeWarehouseQuery(ctx.env, conn.type, config, credentials, 'SELECT 1', {});
      return successResponse({ success: true, message: 'Connection successful' });
    }

    return successResponse({
      success: true,
      message: `Connection type '${conn.type}' test not implemented`,
    });
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      return successResponse({
        success: false,
        error: 'Connection timed out',
      });
    }
    if (err instanceof Error && err.message === 'CREDENTIALS_REQUIRED') {
      return successResponse({
        success: false,
        error: 'Connect your credentials for this connector before testing',
      });
    }
    logError(
      createLogger(ctx.env, {
        scope: 'connections',
        event: 'connection.test.failed',
        artifact_id: ctx.artifactId,
        connection_name: name,
        connection_type: conn.type,
      }),
      'artifact connection test failed',
      err,
    );
    return successResponse({
      success: false,
      error: 'Connection test failed',
    });
  }
}
