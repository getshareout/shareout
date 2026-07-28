import type { AuthUser } from '../../api-auth';
import { createLogger, logError } from '../../logging';
import type { FetchContext } from '../context';
import { requireAuthUser, requireToken, requireTokenOrSession } from './auth-guard';
import { jsonError } from './json-response';

export type ApiAuth = 'token' | 'session' | 'tokenOrSession' | 'none';

export type ApiRouteHandler = (
  ctx: FetchContext,
  params: Record<string, string>,
  user: AuthUser | null,
) => Promise<Response> | Response;

export interface ApiRoute {
  /** HTTP method or list of methods (case-insensitive). */
  method: string | readonly string[];
  /** Path pattern with `:param` segments, e.g. `/v1/artifacts/:id`. */
  path: string;
  auth?: ApiAuth;
  handler: ApiRouteHandler;
}

interface CompiledRoute {
  methods: Set<string>;
  pathPattern: RegExp;
  paramNames: string[];
  auth: ApiAuth;
  handler: ApiRouteHandler;
}

function compilePath(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const parts = path.split('/').map((segment) => {
    if (segment.startsWith(':')) {
      paramNames.push(segment.slice(1));
      return '([^/]+)';
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return {
    pattern: new RegExp(`^${parts.join('/')}$`),
    paramNames,
  };
}

async function resolveAuth(ctx: FetchContext, auth: ApiAuth): Promise<AuthUser | Response | null> {
  switch (auth) {
    case 'token':
      return requireToken(ctx);
    case 'session':
      return requireAuthUser(ctx);
    case 'tokenOrSession':
      return requireTokenOrSession(ctx);
    case 'none':
      return null;
    default:
      return requireAuthUser(ctx);
  }
}

function methodNotAllowed(ctx: FetchContext): Response {
  return ctx.addCORS(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
}

function internalError(ctx: FetchContext): Response {
  return ctx.addCORS(jsonError('Internal server error', 'INTERNAL_ERROR', 500));
}

/** Small Hono-style router for `/v1` control-plane handlers: auth, CORS, 405, and errors in one place. */
export function createApiRouter(routes: ApiRoute[]): (ctx: FetchContext) => Promise<Response | null> {
  const compiled: CompiledRoute[] = routes.map((route) => {
    const { pattern, paramNames } = compilePath(route.path);
    const methods = new Set(
      (Array.isArray(route.method) ? route.method : [route.method]).map((m) => m.toUpperCase()),
    );
    return {
      methods,
      pathPattern: pattern,
      paramNames,
      auth: route.auth ?? 'session',
      handler: route.handler,
    };
  });

  return async (ctx: FetchContext): Promise<Response | null> => {
    const method = ctx.request.method.toUpperCase();
    const matching = compiled.filter((route) => route.pathPattern.test(ctx.path));
    if (matching.length === 0) return null;

    const route = matching.find((r) => r.methods.has(method));
    if (!route) return methodNotAllowed(ctx);

    const authResult = await resolveAuth(ctx, route.auth);
    if (authResult instanceof Response) return authResult;

    const match = ctx.path.match(route.pathPattern);
    if (!match) return null;

    const params: Record<string, string> = {};
    route.paramNames.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]);
    });

    try {
      return ctx.addCORS(await route.handler(ctx, params, authResult));
    } catch (err) {
      const logger = createLogger(ctx.env, {
        event: 'api.handler_error',
        method: ctx.request.method,
        path: ctx.path,
      });
      logError(logger, 'api route handler threw', err);
      return internalError(ctx);
    }
  };
}
