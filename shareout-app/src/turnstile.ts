// Cloudflare Turnstile server-side verification (Workstream F, anti-Sybil). Gates
// the browser email-OTP start so scripts can't mass-create accounts or email-bomb.
// Reads TURNSTILE_CLOUDFLARE_SECRETKEY; when unset (dev / not yet provisioned) it
// no-ops to `true` so the flow keeps working. Token comes from the widget as
// `cf-turnstile-response`; verification is ALWAYS server-side (never the browser).

import type { Env } from './types';
import { fetchWithTimeout } from './fetch-utils';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;

// Server-rendered widget markup for a signup/login form. Returns '' when no site
// key is configured (so forms render normally pre-provisioning). Place the div
// INSIDE the <form>; Cloudflare injects a hidden `cf-turnstile-response` input the
// client reads and posts as `turnstileToken`. data-action enables Spin telemetry.
export function turnstileWidgetHtml(siteKey?: string): string {
  if (!siteKey) return '';
  return `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<div class="cf-turnstile" data-sitekey="${siteKey}" data-action="turnstile-spin-v1" style="margin:8px 0"></div>`;
}

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/** Verify a Turnstile token. Returns true when disabled (no secret configured),
 *  so callers can gate unconditionally without breaking dev/unprovisioned envs. */
export async function verifyTurnstile(env: Env, token: string | null | undefined, ip?: string | null): Promise<boolean> {
  const secret = env.TURNSTILE_CLOUDFLARE_SECRETKEY;
  if (!secret) return true; // not provisioned -> don't block
  if (!token) return false;

  try {
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    if (ip) form.append('remoteip', ip);
    const res = await fetchWithTimeout(SITEVERIFY_URL, { method: 'POST', body: form }, TIMEOUT_MS);
    if (!res.ok) return false;
    const data = (await res.json()) as SiteverifyResponse;
    return data.success === true;
  } catch {
    // Verification outage: fail closed on the protected endpoint.
    return false;
  }
}
