import type { Env } from './types';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

const RATE_LIMITS = {
  accountCreate: { limit: 1, windowSeconds: 86400 },
  publish: { limit: 30, windowSeconds: 3600 },
  aiChat: { limit: 100, windowSeconds: 3600 },
  createPreviewAnon: { limit: 8, windowSeconds: 3600 },
  datasetRefresh: { limit: 6, windowSeconds: 3600 },
  anonymous: { limit: 100, windowSeconds: 60 },
  // Workspace home assistant: aggregate turn ceiling per workspace, and a tighter
  // separate counter for ad-hoc connector queries (each can be expensive).
  webAgentWorkspace: { limit: 500, windowSeconds: 3600 },
  webAgentQuery: { limit: 60, windowSeconds: 3600 },
  // Auth OTP — IP ceilings on top of per-email DB caps (work/047 Ph 4.3).
  emailOtpStart: { limit: 20, windowSeconds: 3600 },
  emailOtpVerify: { limit: 60, windowSeconds: 3600 },
  // Password sign-in: an IP ceiling on top of the per-account lockout. Deliberately
  // tighter than OTP verify — a password is guessable in a way a fresh 6-digit code
  // with a 10-minute life is not.
  passwordLogin: { limit: 20, windowSeconds: 900 },
  accessRequest: { limit: 30, windowSeconds: 3600 },
  adminBridgeAsk: { limit: 30, windowSeconds: 3600 },
} as const;

type RateLimitAction = keyof typeof RATE_LIMITS;

function getWindowStart(windowSeconds: number): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.floor(now / windowSeconds) * windowSeconds;
}

function getWindowEnd(windowSeconds: number): number {
  return getWindowStart(windowSeconds) + windowSeconds;
}

function calculateSlidingWindowCount(
  prevCount: number,
  currCount: number,
  windowSeconds: number
): number {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = getWindowStart(windowSeconds);
  const elapsedInWindow = now - windowStart;
  const windowWeight = elapsedInWindow / windowSeconds;

  // Weighted combination: more weight to current window as time passes
  return Math.floor(prevCount * (1 - windowWeight) + currCount);
}

export async function checkSlidingWindowRateLimit(
  kv: KVNamespace | undefined,
  identifier: string,
  action: RateLimitAction
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[action];
  const reset = getWindowEnd(config.windowSeconds);

  if (!kv) {
    return { allowed: true, limit: config.limit, remaining: config.limit, reset };
  }

  const windowStart = getWindowStart(config.windowSeconds);
  const prevWindowStart = windowStart - config.windowSeconds;

  const currKey = `rl:${action}:${identifier}:${windowStart}`;
  const prevKey = `rl:${action}:${identifier}:${prevWindowStart}`;

  // Fetch both windows in parallel
  const [currValue, prevValue] = await Promise.all([
    kv.get(currKey),
    kv.get(prevKey),
  ]);

  const currCount = currValue ? parseInt(currValue, 10) : 0;
  const prevCount = prevValue ? parseInt(prevValue, 10) : 0;

  const effectiveCount = calculateSlidingWindowCount(prevCount, currCount, config.windowSeconds);

  if (effectiveCount >= config.limit) {
    const retryAfter = reset - Math.floor(Date.now() / 1000);
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      reset,
      retryAfter: Math.max(1, retryAfter),
    };
  }

  // Atomic increment using KV with metadata for optimistic concurrency
  // Note: KV doesn't support true atomic increment, so we accept eventual consistency
  // For strict atomicity, use Durable Objects (see RateLimitCoordinator below)
  await kv.put(currKey, String(currCount + 1), {
    expirationTtl: config.windowSeconds * 2 + 60
  });

  return {
    allowed: true,
    limit: config.limit,
    remaining: Math.max(0, config.limit - effectiveCount - 1),
    reset,
  };
}

// Legacy function for backwards compatibility - now uses sliding window
export async function checkKVRateLimit(
  kv: KVNamespace | undefined,
  identifier: string,
  action: RateLimitAction
): Promise<RateLimitResult> {
  return checkSlidingWindowRateLimit(kv, identifier, action);
}

export async function checkAccountCreation(
  env: Env,
  ip: string
): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, ip, 'accountCreate');
}

export async function checkAiChatLimit(
  env: Env,
  userId: string
): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, userId, 'aiChat');
}

export async function checkWebAgentWorkspaceLimit(
  env: Env,
  workspaceId: string
): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, workspaceId, 'webAgentWorkspace');
}

export async function checkWebAgentQueryLimit(
  env: Env,
  workspaceId: string
): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, workspaceId, 'webAgentQuery');
}

/** Prefer CF-connecting-ip; fall back for local/miniflare where the header is absent. */
export function rateLimitClientKey(request: Request): string {
  return getTrustedClientIp(request) ?? getClientIp(request);
}

export async function checkEmailOtpStartLimit(env: Env, request: Request): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, rateLimitClientKey(request), 'emailOtpStart');
}

export async function checkEmailOtpVerifyLimit(env: Env, request: Request): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, rateLimitClientKey(request), 'emailOtpVerify');
}

export async function checkPasswordLoginLimit(env: Env, request: Request): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, rateLimitClientKey(request), 'passwordLogin');
}

export async function checkAccessRequestLimit(env: Env, userId: string): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, userId, 'accessRequest');
}

export async function checkAdminBridgeAskLimit(env: Env): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, 'bridge', 'adminBridgeAsk');
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.reset),
  };

  if (result.retryAfter !== undefined) {
    headers['Retry-After'] = String(result.retryAfter);
  }

  return headers;
}

export function rateLimitResponse(result: RateLimitResult): Response {
  const secs = result.retryAfter ?? Math.max(0, result.reset - Math.floor(Date.now() / 1000));
  const mins = Math.max(1, Math.ceil(secs / 60));
  return new Response(
    JSON.stringify({
      error: `Rate limit reached (max ${result.limit} per window). Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`,
      code: 'RATE_LIMIT_EXCEEDED',
      limit: result.limit,
      reset: result.reset,
      retryAfter: result.retryAfter,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...rateLimitHeaders(result),
      },
    }
  );
}

export function getClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         'unknown';
}

// Strict client IP for security-sensitive anonymous rate limits (D-5). Uses ONLY
// the Cloudflare-set cf-connecting-ip (which clients cannot spoof) and returns
// null when absent, so callers FAIL CLOSED instead of bucketing everyone under a
// shared spoofable 'unknown'/x-forwarded-for key. Use for anon email/agent/report.
export function getTrustedClientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip') || null;
}
