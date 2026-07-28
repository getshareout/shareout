import type { Env } from './types';
import {
  createLogger,
  logError,
  newRequestId,
  normalizeRoute,
  sanitizeUrl,
  type Logger,
} from './logging';
import { observe } from './observability';
import { isLocalRequest } from './router/helpers/is-local-request';
import { apiErrorResponse } from './http/api-error';

type FetchHandler = (request: Request, env: Env) => Promise<Response>;

function responseLevel(status: number): 'info' | 'warn' | 'error' {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

function logResponse(
  logger: Logger,
  response: Response,
  startedAt: number,
  fields: Record<string, unknown>
): void {
  const durationMs = Date.now() - startedAt;
  const level = responseLevel(response.status);
  const payload = {
    ...fields,
    status: response.status,
    duration_ms: durationMs,
    outcome: level === 'info' ? 'success' : 'http_error',
  };

  if (level === 'error') {
    logger.error('request completed', payload);
  } else if (level === 'warn') {
    logger.warn('request completed', payload);
  } else {
    logger.info('request completed', payload);
  }
}

export async function withRequestLogging(
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  handler: FetchHandler
): Promise<Response> {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const requestId = request.headers.get('cf-ray') || newRequestId();
  const route = normalizeRoute(url.pathname);
  const clientIp = request.headers.get('cf-connecting-ip') || undefined;
  const country = request.headers.get('cf-ipcountry') || undefined;
  const isLocal = isLocalRequest(request, url.hostname);

  const logger = createLogger(env, {
    request_id: requestId,
    event: 'http.request',
    method: request.method,
    path: url.pathname,
    route,
    url: sanitizeUrl(url),
    hostname: url.hostname,
    client_ip: clientIp,
    country,
    user_agent: request.headers.get('user-agent') || undefined,
  });

  logger.debug('request started');

  try {
    const response = await handler(request, env);
    logResponse(logger, response, startedAt, {});

    if (response.webSocket || response.status === 101) {
      return response;
    }

    observe(env, ctx, {
      status: response.status,
      durationMs: Date.now() - startedAt,
      outcome: response.status >= 400 ? 'http_error' : 'success',
      method: request.method,
      route,
      path: url.pathname,
      hostname: url.hostname,
      isLocal,
      requestId,
      country,
    });

    const headers = new Headers(response.headers);
    headers.set('X-Request-Id', requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logError(logger, 'unhandled request error', err, {
      status: 500,
      duration_ms: durationMs,
      outcome: 'exception',
    });

    observe(env, ctx, {
      status: 500,
      durationMs,
      outcome: 'exception',
      method: request.method,
      route,
      path: url.pathname,
      hostname: url.hostname,
      isLocal,
      requestId,
      country,
      message: err instanceof Error ? err.message : String(err),
    });

    // Canonical envelope — never leak err.message / stack to clients.
    return apiErrorResponse(
      {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        status: 500,
      },
      { requestId }
    );
  }
}

export async function logScheduledRun(
  env: Env,
  job: () => Promise<void>
): Promise<void> {
  const startedAt = Date.now();
  const logger = createLogger(env, { event: 'cron.scheduled' });

  logger.info('scheduled job started');

  try {
    await job();
    logger.info('scheduled job completed', { duration_ms: Date.now() - startedAt, outcome: 'success' });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logError(logger, 'scheduled job failed', err, {
      duration_ms: durationMs,
      outcome: 'exception',
    });
    observe(env, undefined, {
      status: 500,
      durationMs,
      outcome: 'exception',
      route: 'cron.scheduled',
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
