/**
 * Connection materialize handler (`POST …/connections/{name}/materialize`).
 *
 * Pulls rows from a connection query (or accepts inline rows) and writes them
 * into an artifact dataset or table via the shared materialize pipeline.
 */
import { DATA_ERRORS } from '../../types';
import {
  successResponse,
  errorResponse,
  resolveRequesterUserId,
  type DataContext,
} from '../middleware';
import { createLogger, logError } from '../../logging';
import { runMaterialize, type MaterializeParams } from '../materialize';
import { mapMaterializeFailure } from './errors';
import { queryConnectionData } from './query';

export async function materializeConnection(
  request: Request,
  ctx: DataContext,
  name: string,
): Promise<Response> {
  let body: {
    query?: string | Record<string, unknown>;
    rows?: unknown[];
    target?: { type: 'dataset' | 'table' | 'json'; name: string; path?: string };
    mode?: 'replace' | 'append';
    format?: 'json' | 'csv';
    options?: { params?: Record<string, unknown> };
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }

  if (!body.target?.type || !body.target?.name) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_REQUEST,
      message: 'target { type: "dataset" | "table" | "json", name } is required',
    }, ctx.origin);
  }
  if (!['dataset', 'table', 'json'].includes(body.target.type)) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_REQUEST,
      message: 'target.type must be "dataset", "table", or "json"',
    }, ctx.origin);
  }

  const params: MaterializeParams = {
    rows: body.rows,
    source: body.rows ? undefined : { connection: name, query: body.query ?? '', options: body.options },
    target: body.target,
    mode: body.mode,
    format: body.format,
  };

  try {
    const result = await runMaterialize(
      ctx.env,
      ctx.artifactId,
      params,
      async (conn, query, p) => queryConnectionData(
        ctx.env,
        ctx.artifactId,
        conn,
        query,
        p,
        await resolveRequesterUserId(request, ctx),
      ),
    );
    return successResponse(result, 201);
  } catch (err) {
    const failure = mapMaterializeFailure(err);
    logError(
      createLogger(ctx.env, {
        scope: 'connections',
        event: 'connection.materialize.failed',
        artifact_id: ctx.artifactId,
        connection_name: name,
        status: failure.status,
        code: failure.code,
      }),
      'artifact connection materialize failed',
      err,
    );
    return errorResponse({
      code: failure.code,
      message: failure.message,
      status: failure.status,
    }, ctx.origin);
  }
}
