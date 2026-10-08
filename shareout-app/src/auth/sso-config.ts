/**
 * Per-workspace OIDC sign-in (Okta, Entra ID, …): config storage and the domain policy.
 *
 * Rows are written only by the instance owner (`/v1/admin/workspaces/:id/sso`). The IdP
 * asserts email addresses, so `email_domains` is the trust boundary: an IdP may sign in
 * only addresses on its own domains, and a domain belongs to at most one workspace.
 */
import type { Env } from '../types';
import { encryptCredentials, decryptCredentials } from '../data/connections/credentials';

export interface SsoConfig {
  workspaceId: string;
  workspaceSlug: string;
  issuer: string;
  clientId: string;
  emailDomains: string[];
  buttonLabel: string;
  enforced: boolean;
}

interface SsoRow {
  workspace_id: string;
  slug: string;
  issuer: string;
  client_id: string;
  encrypted_client_secret: string;
  client_secret_iv: string;
  email_domains: string;
  button_label: string | null;
  is_enforced: number;
}

const SELECT = `SELECT c.workspace_id, w.slug, c.issuer, c.client_id, c.encrypted_client_secret,
  c.client_secret_iv, c.email_domains, c.button_label, c.is_enforced
  FROM workspace_sso_config c JOIN workspaces w ON w.id = c.workspace_id`;

const DOMAIN_REGEX = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

function parseDomains(raw: string): string[] {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

function toConfig(row: SsoRow): SsoConfig {
  return {
    workspaceId: row.workspace_id,
    workspaceSlug: row.slug,
    issuer: row.issuer,
    clientId: row.client_id,
    emailDomains: parseDomains(row.email_domains),
    buttonLabel: row.button_label?.trim() || 'Sign in with SSO',
    enforced: row.is_enforced === 1,
  };
}

export function emailDomain(email: string): string {
  return (email || '').trim().toLowerCase().split('@')[1] || '';
}

export async function getSsoConfigByWorkspaceId(env: Env, workspaceId: string): Promise<SsoConfig | null> {
  const row = await env.DB.prepare(`${SELECT} WHERE c.workspace_id = ?`).bind(workspaceId).first<SsoRow>();
  return row ? toConfig(row) : null;
}

export async function getSsoConfigBySlug(env: Env, slug: string): Promise<SsoConfig | null> {
  const row = await env.DB.prepare(`${SELECT} WHERE w.slug = ?`).bind(slug).first<SsoRow>();
  return row ? toConfig(row) : null;
}

export async function getSsoConfigForEmail(env: Env, email: string): Promise<SsoConfig | null> {
  const domain = emailDomain(email);
  if (!domain) return null;
  const row = await env.DB.prepare(
    `${SELECT}, json_each(c.email_domains) d WHERE d.value = ? LIMIT 1`,
  ).bind(domain).first<SsoRow>();
  return row ? toConfig(row) : null;
}

export async function getSsoClientSecret(env: Env, workspaceId: string): Promise<string> {
  if (!env.CREDENTIALS_KEY) throw new Error('CREDENTIALS_KEY is not set');
  const row = await env.DB.prepare(
    'SELECT encrypted_client_secret, client_secret_iv FROM workspace_sso_config WHERE workspace_id = ?',
  ).bind(workspaceId).first<{ encrypted_client_secret: string; client_secret_iv: string }>();
  if (!row) throw new Error('SSO is not configured for this workspace');
  const { client_secret } = await decryptCredentials(row.encrypted_client_secret, row.client_secret_iv, env.CREDENTIALS_KEY);
  return String(client_secret || '');
}

export function ssoStartPath(slug: string, redirect?: string | null, email?: string | null): string {
  const params = new URLSearchParams({ workspace: slug });
  if (redirect) params.set('redirect', redirect);
  if (email) params.set('login_hint', email);
  return `/auth/sso?${params}`;
}

/**
 * The SSO a non-SSO sign-in must defer to, or null when the address may use any method.
 * Every password / email-code / Google path calls this before minting a session.
 */
export async function ssoRequiredFor(env: Env, email: string): Promise<SsoConfig | null> {
  const config = await getSsoConfigForEmail(env, email);
  return config?.enforced ? config : null;
}

export function ssoRequiredMessage(config: SsoConfig): string {
  return `Your organization requires single sign-on. Use "${config.buttonLabel}" to continue.`;
}

/** JSON body for a refused password / email-code sign-in; the login page follows `redirect_url`. */
export function ssoRequiredBody(config: SsoConfig, email: string) {
  return {
    ok: false,
    error: ssoRequiredMessage(config),
    code: 'SSO_REQUIRED',
    redirect_url: ssoStartPath(config.workspaceSlug, null, email),
  };
}

export interface SsoConfigInput {
  issuer?: string;
  client_id?: string;
  client_secret?: string;
  email_domains?: string[];
  button_label?: string | null;
  enforced?: boolean;
}

export type SsoWriteResult =
  | { ok: true; config: SsoConfig }
  | { ok: false; status: number; error: string; code: string };

function invalid(error: string): SsoWriteResult {
  return { ok: false, status: 400, error, code: 'VALIDATION_ERROR' };
}

export function normalizeIssuer(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    if (url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Create or replace a workspace's SSO config. `client_secret` may be omitted on update. */
export async function upsertSsoConfig(
  env: Env,
  workspaceId: string,
  actorId: string,
  input: SsoConfigInput,
): Promise<SsoWriteResult> {
  if (!env.CREDENTIALS_KEY) {
    return { ok: false, status: 503, error: 'Set the CREDENTIALS_KEY secret before configuring SSO', code: 'CREDENTIALS_KEY_MISSING' };
  }
  const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE id = ?').bind(workspaceId).first();
  if (!ws) return { ok: false, status: 404, error: 'Workspace not found', code: 'NOT_FOUND' };

  const issuer = normalizeIssuer(input.issuer || '');
  if (!issuer) return invalid('issuer must be an https URL, e.g. https://acme.okta.com/oauth2/default');
  const clientId = (input.client_id || '').trim();
  if (!clientId) return invalid('client_id is required');

  const domains = [...new Set((input.email_domains || []).map((d) => String(d).trim().toLowerCase()).filter(Boolean))];
  if (!domains.length) return invalid('email_domains needs at least one domain');
  const bad = domains.find((d) => !DOMAIN_REGEX.test(d));
  if (bad) return invalid(`Not a domain: ${bad}`);

  for (const domain of domains) {
    const owner = await env.DB.prepare(
      'SELECT c.workspace_id FROM workspace_sso_config c, json_each(c.email_domains) d WHERE d.value = ? AND c.workspace_id != ? LIMIT 1',
    ).bind(domain, workspaceId).first<{ workspace_id: string }>();
    if (owner) {
      return { ok: false, status: 409, error: `${domain} already signs in through another workspace's SSO`, code: 'DOMAIN_CLAIMED' };
    }
  }

  const existing = await env.DB.prepare('SELECT 1 FROM workspace_sso_config WHERE workspace_id = ?').bind(workspaceId).first();
  const secret = (input.client_secret || '').trim();
  if (!existing && !secret) return invalid('client_secret is required');

  const label = input.button_label?.trim() || null;
  const enforced = input.enforced === true ? 1 : 0;

  if (secret) {
    const { encrypted, iv } = await encryptCredentials({ client_secret: secret }, env.CREDENTIALS_KEY);
    await env.DB.prepare(
      `INSERT INTO workspace_sso_config
         (workspace_id, issuer, client_id, encrypted_client_secret, client_secret_iv, email_domains, button_label, is_enforced, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         issuer = excluded.issuer, client_id = excluded.client_id,
         encrypted_client_secret = excluded.encrypted_client_secret, client_secret_iv = excluded.client_secret_iv,
         email_domains = excluded.email_domains, button_label = excluded.button_label,
         is_enforced = excluded.is_enforced, updated_by = excluded.updated_by,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(workspaceId, issuer, clientId, encrypted, iv, JSON.stringify(domains), label, enforced, actorId).run();
  } else {
    await env.DB.prepare(
      `UPDATE workspace_sso_config SET issuer = ?, client_id = ?, email_domains = ?, button_label = ?,
         is_enforced = ?, updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE workspace_id = ?`,
    ).bind(issuer, clientId, JSON.stringify(domains), label, enforced, actorId, workspaceId).run();
  }

  const config = await getSsoConfigByWorkspaceId(env, workspaceId);
  if (!config) return { ok: false, status: 500, error: 'SSO config did not save', code: 'INTERNAL_ERROR' };
  return { ok: true, config };
}

export async function deleteSsoConfig(env: Env, workspaceId: string): Promise<boolean> {
  const res = await env.DB.prepare('DELETE FROM workspace_sso_config WHERE workspace_id = ?').bind(workspaceId).run();
  return (res.meta?.changes ?? 0) > 0;
}
