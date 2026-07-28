/**
 * Auth provider detection for self-host (work/047 Phase 1.5).
 * Email OTP always works (logs code when EMAIL binding unset). Google is optional.
 */
import type { Env } from '../types';

export function googleOAuthConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

/** Canonical sign-in URL — email OTP page; Google button only when configured. */
export function signInUrl(redirect = '/home'): string {
  const dest = redirect || '/home';
  return `/auth/login?redirect=${encodeURIComponent(dest)}`;
}
