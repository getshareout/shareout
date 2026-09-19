import { DATA_ERRORS } from '../types';
import { apiErrorResponse } from '../http/api-error';
import type { FetchContext } from './context';

type MethodRule = {
  match: (path: string) => boolean;
  methods: readonly string[];
};

/** Known control-plane paths and their allowed HTTP methods (for 405 vs 404). */
const API_METHOD_RULES: MethodRule[] = [
  { match: (p) => p === '/v1/publish', methods: ['POST'] },
  { match: (p) => p === '/v1/ask', methods: ['POST'] },
  { match: (p) => p === '/v1/artifacts', methods: ['GET'] },
  { match: (p) => p === '/v1/search', methods: ['GET'] },
  { match: (p) => p === '/v1/skill' || p.startsWith('/v1/skill/'), methods: ['GET', 'HEAD'] },
  { match: (p) => p === '/v1/skill/version' || p === '/v1/skill/meta', methods: ['GET'] },
  { match: (p) => /^\/v1\/workspaces\/[^/]+\/subdomain$/.test(p), methods: ['GET', 'POST', 'DELETE'] },
  { match: (p) => p === '/api/proxy', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
  { match: (p) => p === '/health', methods: ['GET'] },
  { match: (p) => p.startsWith('/v1/data/'), methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] },
  { match: (p) => /^\/v1\/files\/[^/]+(\/content)?$/.test(p), methods: ['GET', 'HEAD'] },
  { match: (p) => p.startsWith('/v1/email/') || p === '/v1/webhooks/email-events', methods: ['GET', 'POST'] },
  { match: (p) => p.startsWith('/report/'), methods: ['GET', 'POST'] },
];

export function asGetForHead(request: Request): Request {
  if (request.method !== 'HEAD') return request;
  return new Request(request, { method: 'GET' });
}

export function stripBodyForHead(request: Request, response: Response): Response {
  if (request.method !== 'HEAD') return response;
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function allowedMethodsForPath(path: string): readonly string[] | null {
  for (const rule of API_METHOD_RULES) {
    if (rule.match(path)) return rule.methods;
  }
  return null;
}

/** When a path is registered but the verb is wrong, return 405 + Allow instead of 404. */
export function wrongMethodOnKnownPath(ctx: FetchContext): Response | null {
  const method = ctx.request.method.toUpperCase();
  if (method === 'OPTIONS' || method === 'HEAD') return null;

  const allowed = allowedMethodsForPath(ctx.path);
  if (!allowed || allowed.includes(method)) return null;

  const headers = new Headers({ Allow: allowed.join(', ') });
  return ctx.addCORS(
    apiErrorResponse(DATA_ERRORS.METHOD_NOT_ALLOWED, { headers }),
  );
}
