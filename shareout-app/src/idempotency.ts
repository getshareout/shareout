import type { Env } from './types';

const IDEMPOTENCY_TTL = 86400; // 24 hours
const IDEMPOTENCY_PREFIX = 'idem:';

interface IdempotentResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export async function checkIdempotencyKey(
  env: Env,
  idempotencyKey: string | null
): Promise<IdempotentResult | null> {
  if (!idempotencyKey || !env.RATE_LIMIT_KV) return null;

  const key = `${IDEMPOTENCY_PREFIX}${idempotencyKey}`;
  const cached = await env.RATE_LIMIT_KV.get(key, 'json');

  if (cached) {
    return cached as IdempotentResult;
  }

  return null;
}

export async function storeIdempotencyResult(
  env: Env,
  idempotencyKey: string | null,
  response: Response
): Promise<void> {
  if (!idempotencyKey || !env.RATE_LIMIT_KV) return;

  const key = `${IDEMPOTENCY_PREFIX}${idempotencyKey}`;
  const body = await response.clone().text();

  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (!name.toLowerCase().startsWith('cf-')) {
      headers[name] = value;
    }
  });

  const result: IdempotentResult = {
    status: response.status,
    body,
    headers,
  };

  await env.RATE_LIMIT_KV.put(key, JSON.stringify(result), {
    expirationTtl: IDEMPOTENCY_TTL,
  });
}

export function idempotencyResultToResponse(result: IdempotentResult): Response {
  const headers = new Headers(result.headers);
  headers.set('X-Idempotent-Replayed', 'true');

  return new Response(result.body, {
    status: result.status,
    headers,
  });
}

export function getIdempotencyKey(request: Request): string | null {
  return request.headers.get('X-Idempotency-Key') ||
         request.headers.get('Idempotency-Key');
}

export async function withIdempotency(
  request: Request,
  env: Env,
  handler: () => Promise<Response>
): Promise<Response> {
  const idempotencyKey = getIdempotencyKey(request);

  if (!idempotencyKey) {
    return handler();
  }

  // Check for cached result
  const cached = await checkIdempotencyKey(env, idempotencyKey);
  if (cached) {
    return idempotencyResultToResponse(cached);
  }

  // Execute handler and cache result
  const response = await handler();

  // Only cache successful responses (2xx status codes)
  if (response.status >= 200 && response.status < 300) {
    await storeIdempotencyResult(env, idempotencyKey, response);
  }

  return response;
}
