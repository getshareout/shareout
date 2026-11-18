/**
 * Google Drive import through sharing: every workspace gets its own Google service
 * account. People share a Drive folder with that account's email as Viewer, the way
 * they share with a colleague, and ShareOut reads it as that account. No OAuth consent,
 * so no restricted-scope verification and no user cap.
 *
 * Isolation is Google's ACLs, not our code: a workspace's token is minted only for the
 * account in its own row (`serviceAccountFor(workspaceId)`), and that account can open
 * only what was shared with it. There is no shared account to fall back to — a
 * workspace that cannot get its own account gets an error.
 *
 * One instance key (`GOOGLE_DRIVE_SA_KEY`, a Worker secret) belongs to a "minter"
 * account that creates, deletes and impersonates the per-workspace accounts, which have
 * no keys of their own. Tokens live in memory only.
 *   https://developers.google.com/identity/protocols/oauth2/service-account (JWT bearer)
 *   https://docs.cloud.google.com/iam/docs/create-short-lived-credentials-direct (generateAccessToken)
 *   https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create
 *   https://docs.cloud.google.com/iam/quotas
 */
import type { Env } from '../types';
import type { FileImportProvider } from './types';
import { createLogger } from '../logging';
import { errorText } from './http';
import { configuredProviders } from './oauth';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const IAM = 'https://iam.googleapis.com/v1';
const IAM_CREDENTIALS = 'https://iamcredentials.googleapis.com/v1';
export const DRIVE_SA_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const SKEW_MS = 60_000;
/** Google: a new account "might need … 60 seconds or more" before it can be used. */
export const NEW_ACCOUNT_GRACE_MS = 10 * 60_000;
/** RFC 1035, 6-30 chars — Google's rule for a service account id. */
const ACCOUNT_ID = /^[a-z]([-a-z0-9]{4,28})[a-z0-9]$/;

export interface MinterKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

export interface ServiceAccountRow {
  workspace_id: string;
  account_id: string;
  project_id: string;
  email: string;
  unique_id: string | null;
  status: 'creating' | 'ready';
  created_by: string | null;
  created_at: string;
}

export type ShareErrorCode = 'NOT_CONFIGURED' | 'SHARE_EMAIL_LIMIT' | 'SHARE_EMAIL_FAILED' | 'SHARE_EMAIL_NOT_READY';

/** Why a workspace has no usable share email right now. Never answered with another account. */
export class ShareAccountError extends Error {
  constructor(public code: ShareErrorCode, message: string, public status: number) { super(message); }
}

const LIMIT_MESSAGE = 'Google Drive sharing isn’t available for this workspace yet: this ShareOut instance reached Google’s limit on share emails. Ask your ShareOut admin to raise it.';
const FAILED_MESSAGE = 'Google didn’t create this workspace’s share email. Try again in a few minutes.';
const NOT_READY_MESSAGE = 'Google is still setting up this workspace’s share email. Try again in a minute.';

// ---- the instance key ------------------------------------------------------------

let parsedKey: { raw: string; key: MinterKey | null } | null = null;

/** The minter key, or null when unset or not a service-account JSON key. */
export function minterKey(env: Env): MinterKey | null {
  const raw = env.GOOGLE_DRIVE_SA_KEY || '';
  if (parsedKey?.raw === raw) return parsedKey.key;
  let key: MinterKey | null = null;
  try {
    const j = JSON.parse(raw) as Partial<MinterKey>;
    if (typeof j.client_email === 'string' && typeof j.private_key === 'string' && typeof j.project_id === 'string'
      && j.private_key.includes('PRIVATE KEY') && /^[a-z][-a-z0-9]{4,28}[a-z0-9]$/.test(j.project_id)) {
      key = { client_email: j.client_email, private_key: j.private_key, project_id: j.project_id };
    }
  } catch { /* unset or not JSON */ }
  parsedKey = { raw, key };
  return key;
}

export function serviceAccountConfigured(env: Env): boolean {
  return !!minterKey(env);
}

/** What the import menu offers: the OAuth providers, plus Google Drive when it works by sharing. */
export function importMenuProviders(env: Env): FileImportProvider[] {
  const oauth = configuredProviders(env);
  return serviceAccountConfigured(env) && !oauth.includes('google_drive') ? ['google_drive', ...oauth] : oauth;
}

// ---- JWT (RS256) -----------------------------------------------------------------

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const signingKeys = new Map<string, Promise<CryptoKey>>();

function signingKey(pem: string): Promise<CryptoKey> {
  let k = signingKeys.get(pem);
  if (!k) {
    const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n|\s/g, '');
    const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    k = crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    k.catch(() => signingKeys.delete(pem));
    signingKeys.set(pem, k);
  }
  return k;
}

/** The minter's assertion for Google's token endpoint (max lifetime: 1 hour). */
export async function signJwt(key: MinterKey, scope: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const body = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: key.client_email, scope, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(key.private_key), new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}

// ---- tokens (memory only) ----------------------------------------------------------

const tokens = new Map<string, { token: string; exp: number }>();

/** Tests: forget every cached key and token. */
export function resetServiceAccountCaches(): void {
  tokens.clear();
  signingKeys.clear();
  parsedKey = null;
}

function cached(id: string): string | null {
  const t = tokens.get(id);
  return t && t.exp > Date.now() + SKEW_MS ? t.token : null;
}

async function minterToken(env: Env, key: MinterKey, force = false): Promise<string> {
  const id = `minter:${key.client_email}`;
  const hit = !force && cached(id);
  if (hit) return hit;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signJwt(key, CLOUD_SCOPE) }),
  });
  if (!res.ok) {
    createLogger(env).error('file-imports: Google refused the Drive minter key', { status: res.status, error: await errorText(res) });
    throw new ShareAccountError('SHARE_EMAIL_FAILED', 'Google Drive sharing is misconfigured on this ShareOut instance. Ask your ShareOut admin to check the Drive key.', 502);
  }
  const t = await res.json() as { access_token?: string; expires_in?: number };
  if (!t.access_token) throw new ShareAccountError('SHARE_EMAIL_FAILED', FAILED_MESSAGE, 502);
  tokens.set(id, { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token;
}

/** A call to IAM as the minter, with one retry on a stale minter token. */
async function asMinter(env: Env, key: MinterKey, url: string, init: RequestInit = {}): Promise<Response> {
  const go = async (force: boolean) => fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${await minterToken(env, key, force)}`, Accept: 'application/json' },
  });
  const res = await go(false);
  return res.status === 401 ? go(true) : res;
}

// ---- the workspace's account -------------------------------------------------------

/** The workspace's own account — the only account a token for this workspace is minted for. */
export async function serviceAccountFor(env: Env, workspaceId: string): Promise<ServiceAccountRow | null> {
  return env.DB.prepare('SELECT * FROM file_import_service_accounts WHERE workspace_id = ?').bind(workspaceId).first<ServiceAccountRow>();
}

function newAccountId(): string {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return `so-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** The limit is "Service Account Count" per project; Google documents no error shape for
 *  it, so anything quota-like counts — the person sees the limit message either way. */
function isLimit(status: number, body: string): boolean {
  return status === 429 || /RESOURCE_EXHAUSTED|quota|maximum number|limit/i.test(body);
}

/**
 * The workspace's account, created on first use. Idempotent and safe to race: the row
 * (with its account id) is claimed first, so a retry or a concurrent call creates the
 * same account and Google's 409 tells us it already exists.
 */
export async function ensureServiceAccount(env: Env, workspaceId: string, userId: string | null): Promise<ServiceAccountRow> {
  const key = minterKey(env);
  if (!key) throw new ShareAccountError('NOT_CONFIGURED', 'Google Drive sharing isn’t set up on this ShareOut instance.', 404);
  let row = await serviceAccountFor(env, workspaceId);
  if (row?.status === 'ready') return row;
  if (!row) {
    const accountId = newAccountId();
    await env.DB.prepare(`
      INSERT INTO file_import_service_accounts (workspace_id, account_id, project_id, email, status, created_by)
      VALUES (?, ?, ?, ?, 'creating', ?) ON CONFLICT(workspace_id) DO NOTHING
    `).bind(workspaceId, accountId, key.project_id, `${accountId}@${key.project_id}.iam.gserviceaccount.com`, userId).run();
    row = (await serviceAccountFor(env, workspaceId))!;
  }
  if (!ACCOUNT_ID.test(row.account_id)) throw new ShareAccountError('SHARE_EMAIL_FAILED', FAILED_MESSAGE, 500);
  const log = createLogger(env, { workspaceId });
  let res = await asMinter(env, key, `${IAM}/projects/${encodeURIComponent(row.project_id)}/serviceAccounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: row.account_id,
      serviceAccount: {
        displayName: `ShareOut ${workspaceId}`.slice(0, 100),
        description: `Drive import for ShareOut workspace ${workspaceId}. ShareOut deletes it with the workspace.`.slice(0, 256),
      },
    }),
  });
  if (res.status === 409) res = await asMinter(env, key, `${IAM}/projects/-/serviceAccounts/${encodeURIComponent(row.email)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (isLimit(res.status, body)) {
      log.error('file-imports: Google service-account limit reached; this workspace has no share email', { status: res.status, project: row.project_id });
      throw new ShareAccountError('SHARE_EMAIL_LIMIT', LIMIT_MESSAGE, 503);
    }
    log.error('file-imports: creating the workspace service account failed', { status: res.status, body: body.slice(0, 300) });
    throw new ShareAccountError('SHARE_EMAIL_FAILED', FAILED_MESSAGE, 502);
  }
  const sa = await res.json() as { email?: string; uniqueId?: string };
  if (sa.email && sa.email.toLowerCase() !== row.email.toLowerCase()) {
    log.error('file-imports: Google returned a different service account than the one claimed', { want: row.email });
    throw new ShareAccountError('SHARE_EMAIL_FAILED', FAILED_MESSAGE, 502);
  }
  await env.DB.prepare(`
    UPDATE file_import_service_accounts SET status = 'ready', unique_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE workspace_id = ? AND account_id = ?
  `).bind(sa.uniqueId ?? null, workspaceId, row.account_id).run();
  return { ...row, status: 'ready', unique_id: sa.uniqueId ?? null };
}

/** A Drive read token for this workspace's own account (impersonated, ≤1 hour, memory only). */
export async function workspaceDriveToken(env: Env, sa: ServiceAccountRow, force = false): Promise<string> {
  const key = minterKey(env);
  if (!key) throw new ShareAccountError('NOT_CONFIGURED', 'Google Drive sharing isn’t set up on this ShareOut instance.', 404);
  if (sa.status !== 'ready') throw new ShareAccountError('SHARE_EMAIL_NOT_READY', NOT_READY_MESSAGE, 409);
  const id = `ws:${sa.email}`;
  const hit = !force && cached(id);
  if (hit) return hit;
  const res = await asMinter(env, key, `${IAM_CREDENTIALS}/projects/-/serviceAccounts/${encodeURIComponent(sa.email)}:generateAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: [DRIVE_SA_SCOPE], lifetime: '3600s' }),
  });
  if (!res.ok) {
    const young = Date.now() - Date.parse(sa.created_at) < NEW_ACCOUNT_GRACE_MS;
    if (young && (res.status === 403 || res.status === 404)) throw new ShareAccountError('SHARE_EMAIL_NOT_READY', NOT_READY_MESSAGE, 409);
    createLogger(env, { workspaceId: sa.workspace_id }).error('file-imports: impersonating the workspace service account failed', { status: res.status, error: await errorText(res) });
    throw new ShareAccountError('SHARE_EMAIL_FAILED', 'ShareOut couldn’t read Google Drive as this workspace. Try again in a few minutes.', 502);
  }
  const t = await res.json() as { accessToken?: string; expireTime?: string };
  if (!t.accessToken) throw new ShareAccountError('SHARE_EMAIL_FAILED', FAILED_MESSAGE, 502);
  const exp = Date.parse(t.expireTime || '');
  tokens.set(id, { token: t.accessToken, exp: Number.isFinite(exp) ? exp : Date.now() + 3600_000 });
  return t.accessToken;
}

/** Delete an account at Google. Already gone counts as deleted. */
export async function deleteServiceAccount(env: Env, email: string): Promise<boolean> {
  const key = minterKey(env);
  if (!key) return false;
  const res = await asMinter(env, key, `${IAM}/projects/-/serviceAccounts/${encodeURIComponent(email)}`, { method: 'DELETE' });
  return res.ok || res.status === 404;
}

/**
 * Hourly: delete the accounts of workspaces that no longer exist, at Google first and
 * then here, so no account is left holding folders nobody can see in ShareOut.
 */
export async function sweepOrphanedServiceAccounts(env: Env, limit = 10): Promise<{ deleted: number }> {
  if (!serviceAccountConfigured(env)) return { deleted: 0 };
  const rows = (await env.DB.prepare(`
    SELECT sa.workspace_id, sa.email FROM file_import_service_accounts sa
    LEFT JOIN workspaces w ON w.id = sa.workspace_id WHERE w.id IS NULL LIMIT ?
  `).bind(limit).all<{ workspace_id: string; email: string }>()).results || [];
  let deleted = 0;
  for (const r of rows) {
    if (!(await deleteServiceAccount(env, r.email).catch(() => false))) continue;
    await env.DB.prepare('DELETE FROM file_import_service_accounts WHERE workspace_id = ? AND email = ?').bind(r.workspace_id, r.email).run();
    deleted++;
  }
  return { deleted };
}
