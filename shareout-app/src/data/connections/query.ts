/**
 * Connection query execution — HTTP handler and server-side programmatic API.
 *
 * `executeQuery` serves `POST …/connections/{name}/query` with caching and rate
 * limits. `queryConnectionData` is the programmatic entry used by materialize,
 * scheduled jobs, and agent tools.
 */
import type { Env } from '../../types';
import { DATA_ERRORS } from '../../types';
import {
  successResponse,
  errorResponse,
  resolveRequesterUserId,
  type DataContext,
} from '../middleware';
import { connectionCacheKey } from './user-credentials';
import { getCachedResult, cacheResult } from './cache';
import { checkRateLimit, getRateLimitInfo } from './rate-limiter';
import { createLogger, logError } from '../../logging';
import { executeWarehouseQuery } from './warehouse-exec';
import { UpstreamHttpError, mapQueryFailure, userFacingQueryError } from './errors';
import {
  resolveGenericConnection,
  recordConnectionUsage,
  resolveConnectionCredentials,
} from './resolve';
import { executeRestApiQuery } from './rest-query';

export async function executeQuery(
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

  if (conn.scope === 'workspace' && conn.workspace_id) {
    const rec = recordConnectionUsage(ctx.env, conn.id, ctx.artifactId);
    if (ctx.waitUntil) ctx.waitUntil(rec);
  }

  let body: { query: string | Record<string, unknown>; options?: { cache?: boolean; ttl?: number; params?: Record<string, unknown> } };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON body' });
  }

  const { query, options } = body;
  const userId = await resolveRequesterUserId(request, ctx);
  const cacheId = connectionCacheKey(
    conn.id,
    userId,
    conn.credential_scope ?? 'shared',
  );

  const rateLimitOk = await checkRateLimit(ctx.env, cacheId, conn.rate_limit_rpm);
  if (!rateLimitOk) {
    getRateLimitInfo(cacheId, conn.rate_limit_rpm);
    return errorResponse({
      code: 'RATE_LIMITED',
      message: `Rate limit exceeded (${conn.rate_limit_rpm} requests/minute)`,
      status: 429,
    });
  }

  const useCache = options?.cache !== false;
  if (useCache) {
    const cached = await getCachedResult(ctx.env, cacheId, query, options?.params);
    if (cached !== null) {
      return successResponse({
        data: cached,
        cached: true,
        executionTimeMs: 0,
      });
    }
  }

  const start = Date.now();

  try {
    const { credentials, credType } = await resolveConnectionCredentials(ctx.env, conn, userId);
    const config = JSON.parse(conn.config) as Record<string, unknown>;
    let result: unknown;

    if (conn.type === 'rest_api') {
      result = await executeRestApiQuery(config, credentials, credType, query, options?.params);
    } else if (conn.type === 'snowflake' || conn.type === 'bigquery') {
      const sql = typeof query === 'string'
        ? query
        : String((query as Record<string, unknown>)?.sql ?? (query as Record<string, unknown>)?.query ?? '');
      if (!sql) {
        return errorResponse({
          code: 'INVALID_REQUEST',
          message: 'Provide the SQL string in "query" for a warehouse connection',
          status: 400,
        }, ctx.origin);
      }
      result = await executeWarehouseQuery(ctx.env, conn.type, config, credentials, sql, {
        projectId: (options?.params?.projectId ?? options?.params?.project) as string | undefined,
        maxResults: typeof options?.params?.maxResults === 'number' ? options.params.maxResults : undefined,
        timeoutMs: typeof options?.params?.timeoutMs === 'number' ? options.params.timeoutMs : undefined,
      });
    } else {
      return errorResponse({
        code: 'PROVIDER_NOT_IMPLEMENTED',
        message: `Provider '${conn.type}' not implemented`,
        status: 501,
      }, ctx.origin);
    }

    const executionTimeMs = Date.now() - start;

    const ttl = options?.ttl || conn.cache_ttl_seconds;
    if (ttl > 0) {
      await cacheResult(ctx.env, cacheId, query, options?.params, result, ttl);
    }

    return successResponse({
      data: result,
      cached: false,
      executionTimeMs,
      rowCount: Array.isArray(result) ? result.length : undefined,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'CREDENTIALS_REQUIRED') {
      return errorResponse({
        code: 'CREDENTIALS_REQUIRED',
        message: 'Connect your credentials for this connector before querying',
        status: 403,
      }, ctx.origin);
    }

    const { code, status, upstreamStatus } = mapQueryFailure(err);
    logError(
      createLogger(ctx.env, {
        scope: 'connections',
        event: 'connection.query.failed',
        artifact_id: ctx.artifactId,
        connection_id: conn.id,
        connection_name: name,
        connection_type: conn.type,
        connection_scope: conn.scope,
        status,
        code,
        upstream_status: upstreamStatus,
      }),
      'artifact connection query failed',
      err,
    );
    return errorResponse({
      code,
      message: userFacingQueryError(err, code, upstreamStatus),
      status,
    });
  }
}

/**
 * Run a connection query server-side and return the raw result (rows). Used by the
 * materialize flow and scheduled refresh. `rest_api` runs through the REST executor;
 * `snowflake`/`bigquery` run through the warehouse provider directly on the
 * connection's inline credentials, so unattended jobs can pull fresh warehouse rows
 * without a caller-supplied `rows`. `postgres` has no server-side engine yet.
 */
export async function queryConnectionData(
  env: Env,
  artifactId: string,
  name: string,
  query: string | Record<string, unknown>,
  params?: Record<string, unknown>,
  userId?: string | null,
): Promise<unknown> {
  if (!env.CREDENTIALS_KEY) throw new Error('CREDENTIALS_KEY not configured');

  const conn = await resolveGenericConnection(env, artifactId, name);
  if (!conn) throw new Error(`Connection "${name}" not found`);

  if (conn.scope === 'workspace' && conn.workspace_id) {
    await recordConnectionUsage(env, conn.id, artifactId);
  }

  if (conn.credential_scope === 'per_user' && !userId) {
    throw new Error('CREDENTIALS_REQUIRED');
  }

  const { credentials, credType } = await resolveConnectionCredentials(env, conn, userId ?? null);
  const config = JSON.parse(conn.config) as Record<string, unknown>;
  if (conn.type === 'rest_api') {
    return executeRestApiQuery(config, credentials, credType, query, params);
  }
  if (conn.type === 'snowflake' || conn.type === 'bigquery') {
    const sql = typeof query === 'string'
      ? query
      : String((query as Record<string, unknown>)?.sql ?? (query as Record<string, unknown>)?.query ?? '');
    if (!sql) throw new Error('Provide the SQL string in "query" for a warehouse connection');
    return executeWarehouseQuery(env, conn.type, config, credentials, sql, {
      projectId: (params?.projectId ?? params?.project) as string | undefined,
      maxResults: typeof params?.maxResults === 'number' ? params.maxResults : undefined,
      timeoutMs: typeof params?.timeoutMs === 'number' ? params.timeoutMs : undefined,
    });
  }
  throw new Error(`Server-side query not supported for connection type "${conn.type}". Use inline rows materialization.`);
}
