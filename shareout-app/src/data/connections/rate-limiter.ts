import type { Env } from '../../types';

interface RateLimitWindow {
  count: number;
  windowStart: number;
}

const WINDOW_SIZE_MS = 60 * 1000; // 1 minute window

const rateLimitCache = new Map<string, RateLimitWindow>();

export async function checkRateLimit(
  env: Env,
  connectionId: string,
  limitPerMinute: number
): Promise<boolean> {
  const now = Date.now();
  const key = `ratelimit:${connectionId}`;

  let window = rateLimitCache.get(key);

  if (!window || now - window.windowStart > WINDOW_SIZE_MS) {
    window = { count: 0, windowStart: now };
    rateLimitCache.set(key, window);
  }

  if (window.count >= limitPerMinute) {
    return false;
  }

  window.count++;
  return true;
}

export function getRateLimitInfo(
  connectionId: string,
  limitPerMinute: number
): { remaining: number; resetAt: number } | null {
  const key = `ratelimit:${connectionId}`;
  const window = rateLimitCache.get(key);

  if (!window) {
    return { remaining: limitPerMinute, resetAt: Date.now() + WINDOW_SIZE_MS };
  }

  const remaining = Math.max(0, limitPerMinute - window.count);
  const resetAt = window.windowStart + WINDOW_SIZE_MS;

  return { remaining, resetAt };
}

export function resetRateLimit(connectionId: string): void {
  const key = `ratelimit:${connectionId}`;
  rateLimitCache.delete(key);
}

export function cleanupStaleLimits(): void {
  const now = Date.now();
  for (const [key, window] of rateLimitCache) {
    if (now - window.windowStart > WINDOW_SIZE_MS * 2) {
      rateLimitCache.delete(key);
    }
  }
}
