import type { Env } from '../types';
import { generateToken, hashToken } from '../api-auth';
import { generateId } from '../crypto-utils';
import { getSessionUser } from './session';
import { errorPage } from './pages';
import { jsonWithApiErrors } from '../http/api-error';

const DEVICE_EXPIRY_SEC = 10 * 60; // 10 minutes to complete the browser step
const POLL_INTERVAL_SEC = 5;

// Human-typable alphabet: no 0/O/1/I/L ambiguity.
const USER_CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 8 chars from the unambiguous alphabet, formatted XXXX-XXXX.
function generateUserCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes).map(b => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export function normalizeUserCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
}

interface DeviceRow {
  id: string;
  device_code: string;
  user_code: string;
  status: string;
  user_id: string | null;
  token: string | null;
  warn: string | null;
  expires_at: string;
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// POST /v1/auth/device/start — CLI opens a login. No auth required.
// Optional body { expected_email } (the email the user expects to sign in as, e.g. the
// address a teammate invited) pre-selects the Google account and drives the mismatch warn.
export async function handleDeviceStart(request: Request, env: Env): Promise<Response> {
  let expectedEmail: string | null = null;
  try {
    const body = (await request.json()) as { expected_email?: string };
    expectedEmail = normalizeEmail(body?.expected_email);
  } catch {
    // no body → no hint
  }

  const deviceCode = randomSecret();
  const userCode = generateUserCode();
  const id = generateId('dev');
  const expiresAt = new Date(Date.now() + DEVICE_EXPIRY_SEC * 1000).toISOString();
  const ip = request.headers.get('cf-connecting-ip') || null;

  await env.DB.prepare(
    `INSERT INTO device_auth (id, device_code, user_code, expected_email, expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, deviceCode, userCode, expectedEmail, expiresAt, ip).run();

  const base = env.SHAREOUT_BASE_URL.replace(/\/$/, '');
  return json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${base}/auth/device`,
    verification_uri_complete: `${base}/auth/device?code=${encodeURIComponent(userCode)}`,
    interval: POLL_INTERVAL_SEC,
    expires_in: DEVICE_EXPIRY_SEC,
  }, 201);
}

// POST /v1/auth/device/token — CLI polls with { device_code }. No auth required
// (the device_code is the secret). Returns the token exactly once, then consumes the row.
export async function handleDevicePoll(request: Request, env: Env): Promise<Response> {
  let deviceCode: string | undefined;
  try {
    const body = (await request.json()) as { device_code?: string };
    deviceCode = body?.device_code;
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  if (!deviceCode) return json({ error: 'invalid_request' }, 400);

  const row = await env.DB.prepare(
    `SELECT id, status, user_id, token, warn, expires_at FROM device_auth WHERE device_code = ?`
  ).bind(deviceCode).first<DeviceRow>();

  if (!row) return json({ error: 'invalid_grant' }, 400);

  const now = new Date().toISOString();
  if (row.expires_at < now) {
    await env.DB.prepare('DELETE FROM device_auth WHERE id = ?').bind(row.id).run();
    return json({ error: 'expired_token' }, 400);
  }

  if (row.status === 'denied') {
    await env.DB.prepare('DELETE FROM device_auth WHERE id = ?').bind(row.id).run();
    return json({ error: 'access_denied' }, 400);
  }

  if (row.status !== 'approved' || !row.token) {
    return json({ status: 'pending', interval: POLL_INTERVAL_SEC });
  }

  // Approved — hand the token over exactly once, then consume the row.
  await env.DB.prepare('DELETE FROM device_auth WHERE id = ?').bind(row.id).run();
  return json({ status: 'approved', token: row.token, user_id: row.user_id, warn: row.warn || undefined });
}

// Marks a pending device row approved and stamps a freshly-minted `so_` token on it.
// Called from the Google OAuth callback once the browser user is authenticated.
// Returns a per-user warning string (or null) so the callback can surface it.
export async function approveDeviceCode(
  env: Env,
  userCode: string,
  userId: string,
  userEmail: string | null,
): Promise<{ ok: true; token: string; warn: string | null } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT id, status, expected_email, expires_at FROM device_auth WHERE user_code = ?`
  ).bind(userCode).first<{ id: string; status: string; expected_email: string | null; expires_at: string }>();

  if (!row) return { ok: false, error: 'That login code was not found. Start the CLI login again.' };
  if (row.expires_at < now) return { ok: false, error: 'That login code expired. Start the CLI login again.' };
  if (row.status === 'approved') return { ok: false, error: 'That login code was already used.' };

  // Precise warn: only fire when the CLI told us which email to expect (e.g. an invite)
  // and the user actually signed in as a *different* one. A brand-new solo signup with no
  // expected email gets silence — no-workspace is not an error.
  const signedInAs = (userEmail || '').toLowerCase();
  const warn = row.expected_email && signedInAs && row.expected_email !== signedInAs
    ? `You signed in as ${signedInAs}, but this login expected ${row.expected_email}. If you meant to join that team, restart and pick the ${row.expected_email} account.`
    : null;

  const token = generateToken();
  const tokenHash = await hashToken(token);
  await env.DB.prepare(
    "INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES (?, 'user', ?, ?, ?, ?)"
  ).bind(generateId('tok'), userId, userId, tokenHash, 'device-login').run();

  await env.DB.prepare(
    `UPDATE device_auth SET status = 'approved', user_id = ?, token = ?, warn = ?, approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).bind(userId, token, warn, row.id).run();

  return { ok: true, token, warn };
}

// GET /auth/device[?code=USER-CODE] — browser landing. With a code + session, approve
// the CLI login (works for email OTP and post-Google redirect). Otherwise send the
// user through /auth/login, then back here.
export async function handleDevicePage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const rawCode = url.searchParams.get('code') || '';
  const code = rawCode ? normalizeUserCode(rawCode) : '';

  if (code) {
    const session = await getSessionUser(request, env);
    if (session) {
      const result = await approveDeviceCode(env, code, session.id, session.email);
      if (!result.ok) return errorPage(result.error, '/');
      return deviceDonePage(session.email, result.warn);
    }
  }

  let loginHint: string | null = null;
  if (code) {
    const now = new Date().toISOString();
    const row = await env.DB.prepare(
      'SELECT expected_email FROM device_auth WHERE user_code = ? AND expires_at > ?'
    ).bind(code, now).first<{ expected_email: string | null }>();
    loginHint = row?.expected_email ?? null;
  }

  return devicePage(code, loginHint);
}

/** OTP/Google redirect target — same approve path as /auth/device?code= when sessioned. */
export async function handleDeviceDone(request: Request, env: Env): Promise<Response> {
  return handleDevicePage(request, env);
}

export async function cleanupExpiredDeviceCodes(env: Env): Promise<number> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare('DELETE FROM device_auth WHERE expires_at < ?').bind(now).run();
  return result.meta?.changes || 0;
}

// --- page rendering (kept local to the feature) ---
import { renderHtmlPage } from '../design-system/shell';
import { authPageStyles } from '../design-system/pages/auth.css';
import { escapeHtml } from '../html/utils';

function devicePage(code: string, loginHint?: string | null): Response {
  // After sign-in, land back on /auth/device?code= so handleDevicePage can approve
  // (email OTP and Google both work). login_hint only helps Google account pick.
  const hintParam = loginHint ? `&login_hint=${encodeURIComponent(loginHint)}` : '';
  const signInHref = `/auth/login?redirect=${encodeURIComponent(`/auth/device?code=${code}`)}${hintParam}`;
  const codeField = code
    ? `<p class="auth-help">Login code <span class="email">${escapeHtml(code)}</span></p>`
    : `<form method="GET" action="/auth/device" class="email-code-form" novalidate>
         <div class="field">
           <label class="field-label" for="device-code">Enter the code from your terminal</label>
           <input id="device-code" type="text" name="code" autocomplete="one-time-code" placeholder="XXXX-XXXX" required>
         </div>
         <button type="submit" class="so-c-btn so-c-btn--secondary so-c-btn--block">Continue</button>
       </form>`;
  const continueButton = code
    ? `<a href="${escapeHtml(signInHref)}" class="so-c-btn so-c-btn--primary so-c-btn--block">Sign in to approve</a>`
    : '';
  return renderHtmlPage({
    title: 'Authorize CLI login - ShareOut',
    pageStyles: authPageStyles,
    body: `
    <div class="card">
      <div class="icon icon-primary">🔑</div>
      <h1>Authorize CLI login</h1>
      <p>A command-line tool is asking to sign in as you. Sign in to approve it.</p>
      ${codeField}
      ${continueButton}
      <div class="footer">Powered by <a href="/">ShareOut</a></div>
    </div>`,
  });
}

export function deviceDonePage(email: string, warn: string | null): Response {
  const warnHtml = warn
    ? `<p class="auth-help auth-help--warning">${escapeHtml(warn)}</p>`
    : '';
  return renderHtmlPage({
    title: 'Signed in - ShareOut',
    pageStyles: authPageStyles,
    body: `
    <div class="card">
      <div class="icon icon-success">✓</div>
      <h1>You're signed in</h1>
      <p>Authorized as <span class="email">${escapeHtml(email)}</span>. Return to your terminal — it should pick up automatically.</p>
      ${warnHtml}
      <div class="footer">Powered by <a href="/">ShareOut</a></div>
    </div>`,
  });
}
