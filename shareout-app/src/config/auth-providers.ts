/**
 * Auth provider detection for self-host (work/047 Phase 1.5).
 * Email OTP always works (logs code when EMAIL binding unset). Google and Microsoft are optional.
 */
import type { Env } from '../types';

export function googleOAuthConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

const MICROSOFT_AUDIENCES = new Set(['common', 'organizations', 'consumers']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The Microsoft authority segment, or null when MICROSOFT_TENANT is not a value we can validate tokens for. */
export function microsoftTenant(env: Env): string | null {
  const tenant = (env.MICROSOFT_TENANT || '').trim().toLowerCase() || 'common';
  return MICROSOFT_AUDIENCES.has(tenant) || GUID.test(tenant) ? tenant : null;
}

export function microsoftOAuthConfigured(env: Env): boolean {
  return Boolean(env.MICROSOFT_CLIENT_ID?.trim() && env.MICROSOFT_CLIENT_SECRET?.trim() && microsoftTenant(env));
}

/** Canonical sign-in URL — email OTP page; Google button only when configured. */
export function signInUrl(redirect = '/home'): string {
  const dest = redirect || '/home';
  return `/auth/login?redirect=${encodeURIComponent(dest)}`;
}
