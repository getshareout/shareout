/**
 * Provider HTTP with backoff. Both APIs throttle per user and per app: Drive answers
 * 429 or 403 with reason rateLimitExceeded / userRateLimitExceeded, Graph answers 429
 * (or 503) with Retry-After. We honour Retry-After when given, else back off
 * exponentially with jitter, and give up after MAX_RETRIES so the durable step that
 * called us can retry later on its own schedule.
 *   https://developers.google.com/workspace/drive/api/guides/limits
 *   https://learn.microsoft.com/en-us/graph/throttling
 */

export const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 32_000;

/** Indirection so tests can skip the waiting. */
export const timing = {
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
};

export class ProviderError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Thrown when the provider is still throttling after every retry. */
export class RateLimitedError extends ProviderError {
  constructor(message = 'The provider is rate limiting this import; it will continue shortly.') {
    super(429, 'RATE_LIMITED', message);
  }
}

/** Thrown on 401 after a refresh — the consent is gone or was revoked. */
export class AuthExpiredError extends ProviderError {
  constructor() {
    super(401, 'CONNECTION_REVOKED', 'The connection to this drive is no longer valid. Reconnect it.');
  }
}

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

async function isRateLimited(res: Response): Promise<boolean> {
  if (res.status === 429 || res.status === 503 || res.status === 500 || res.status === 502 || res.status === 504) return true;
  if (res.status !== 403) return false;
  const body = await res.clone().json().catch(() => null) as { error?: { errors?: Array<{ reason?: string }> } } | null;
  return !!body?.error?.errors?.some((e) => e.reason && RATE_REASONS.has(e.reason));
}

export function retryDelayMs(res: Response | null, attempt: number): number {
  const ra = res?.headers.get('Retry-After');
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_DELAY_MS * 2);
    const at = Date.parse(ra);
    if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), MAX_DELAY_MS * 2));
  }
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return exp + Math.floor(Math.random() * BASE_DELAY_MS);
}

/** fetch, retried on throttling and transient 5xx. Other statuses are returned as-is. */
export async function fetchWithBackoff(url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      await timing.sleep(retryDelayMs(null, attempt));
      continue;
    }
    if (!(await isRateLimited(res))) return res;
    if (attempt >= MAX_RETRIES) throw new RateLimitedError();
    await timing.sleep(retryDelayMs(res, attempt));
  }
}

/** GET JSON with a bearer token; maps 401 and other failures to typed errors. */
export async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetchWithBackoff(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (res.status === 401) throw new AuthExpiredError();
  if (!res.ok) throw new ProviderError(res.status, res.status === 404 ? 'NOT_FOUND' : 'PROVIDER_ERROR', await errorText(res));
  return res.json() as Promise<T>;
}

export async function errorText(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; error_description?: string };
    if (typeof j.error === 'object' && j.error?.message) return j.error.message.slice(0, 300);
    if (j.error_description) return j.error_description.slice(0, 300);
  } catch { /* not JSON */ }
  return `HTTP ${res.status}`;
}
