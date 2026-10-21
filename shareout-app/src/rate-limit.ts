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
  // Anonymous visitor chat: a single IP stays well under the owner-wide anon budget so
  // one network cannot lock every other visitor out of the owner's artifacts.
  aiChatAnonIp: { limit: 40, windowSeconds: 3600 },
  aiChatAnonOwner: { limit: 200, windowSeconds: 3600 },
  // Operator-funded Create LLM calls: anonymous planner per IP, signed-in preview per user.
  createPlanAnon: { limit: 30, windowSeconds: 3600 },
  createPreviewUser: { limit: 60, windowSeconds: 3600 },
  // Anonymous beacons fired from artifact pages. perf is one hit per page load; presence
  // is one per ~20 s per open tab (180/h), so 6000/h per IP fits ~33 tabs behind one NAT.
  perfBeacon: { limit: 1200, windowSeconds: 3600 },
  presenceBeacon: { limit: 6000, windowSeconds: 3600 },
  createPreviewAnon: { limit: 8, windowSeconds: 3600 },
  datasetRefresh: { limit: 6, windowSeconds: 3600 },
  // Shared anonymous bucket: emails sent from public artifacts by signed-out visitors
  // (`email:<ip>`) and abuse reports (`report:<ip>`). Each allowed hit is one KV write,
  // so 100/min allowed ~144k writes per IP per day; 20/hour caps it at 480 while
  // leaving room for a busy contact form or several reports from one network.
  anonymous: { limit: 20, windowSeconds: 3600 },
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
  artifactGate: { limit: 20, windowSeconds: 900 },
  artifactGateGlobal: { limit: 200, windowSeconds: 900 },
  // Guest comments (no account): codes per IP on top of the per-address DB caps, and
  // comment ceilings per IP and per verified guest.
  guestCodeStart: { limit: 10, windowSeconds: 3600 },
  guestCodeVerify: { limit: 30, windowSeconds: 3600 },
  guestCommentIp: { limit: 30, windowSeconds: 3600 },
  guestCommentToken: { limit: 20, windowSeconds: 3600 },
  reportProblem: { limit: 5, windowSeconds: 3600 },
  accessRequest: { limit: 30, windowSeconds: 3600 },
  adminBridgeAsk: { limit: 30, windowSeconds: 3600 },
  // "Ask an admin" from a refused action; per-reason dedupe sits in the handler.
  adminRequest: { limit: 20, windowSeconds: 3600 },
  // MCP connector OAuth. Registration is per IP but generous: hosted AI apps register
  // one client per connection from a handful of shared egress IPs. Token calls are
  // per client (one connection), MCP calls per user.
  oauthRegister: { limit: 600, windowSeconds: 3600 },
  oauthToken: { limit: 120, windowSeconds: 3600 },
  mcp: { limit: 600, windowSeconds: 3600 },
  // A page calling the viewer's MCP connections, per viewer + page. Sized for a
  // dashboard of several sections each refreshing about every 30 s.
  mcpBroker: { limit: 1200, windowSeconds: 3600 },
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
  action: RateLimitAction,
  defer?: (write: Promise<unknown>) => void
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
  const write = kv.put(currKey, String(currCount + 1), {
    expirationTtl: config.windowSeconds * 2 + 60
  });
  if (defer) defer(write);
  else await write;

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
  action: RateLimitAction,
  defer?: (write: Promise<unknown>) => void
): Promise<RateLimitResult> {
  return checkSlidingWindowRateLimit(kv, identifier, action, defer);
}

export async function checkAccountCreation(
  env: Env,
  ip: string
): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, ip, 'accountCreate');
}

export async function checkAiChatLimit(
  env: Env,
  userId: string,
  defer?: (write: Promise<unknown>) => void
): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, userId, 'aiChat', defer);
}

export async function checkWebAgentWorkspaceLimit(
  env: Env,
  workspaceId: string,
  defer?: (write: Promise<unknown>) => void
): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, workspaceId, 'webAgentWorkspace', defer);
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

export async function checkArtifactGateLimit(env: Env, request: Request, artifactId: string): Promise<RateLimitResult> {
  const perClient = await checkKVRateLimit(env.RATE_LIMIT_KV, `${artifactId}:${rateLimitClientKey(request)}`, 'artifactGate');
  if (!perClient.allowed) return perClient;
  return checkKVRateLimit(env.RATE_LIMIT_KV, artifactId, 'artifactGateGlobal');
}

export async function checkReportProblemLimit(env: Env, userId: string): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, userId, 'reportProblem');
}

export async function checkAccessRequestLimit(env: Env, userId: string): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, userId, 'accessRequest');
}

export async function checkAdminRequestLimit(env: Env, userId: string): Promise<RateLimitResult> {
  return checkKVRateLimit(env.RATE_LIMIT_KV, userId, 'adminRequest');
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
