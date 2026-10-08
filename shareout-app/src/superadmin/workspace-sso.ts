/**
 * Instance-owner management of a workspace's OIDC sign-in. Storage and the domain
 * policy live in `auth/sso-config`; this adds validation against the live IdP and the
 * audit trail.
 */
import type { Env } from '../types';
import { logAudit } from '../audit';
import { discover } from '../auth/oidc';
import {
  deleteSsoConfig,
  getSsoConfigByWorkspaceId,
  normalizeIssuer,
  ssoStartPath,
  upsertSsoConfig,
  type SsoConfig,
  type SsoConfigInput,
} from '../auth/sso-config';
import type { ProvisionResult } from './workspaces-provision';

function view(env: Env, config: SsoConfig) {
  const base = env.SHAREOUT_BASE_URL.replace(/\/$/, '');
  return {
    workspace_id: config.workspaceId,
    workspace_slug: config.workspaceSlug,
    issuer: config.issuer,
    client_id: config.clientId,
    email_domains: config.emailDomains,
    button_label: config.buttonLabel,
    enforced: config.enforced,
    redirect_uri: `${base}/auth/sso/callback`,
    sign_in_url: `${base}${ssoStartPath(config.workspaceSlug)}`,
  };
}

export async function getWorkspaceSso(env: Env, workspaceId: string): Promise<ProvisionResult> {
  const config = await getSsoConfigByWorkspaceId(env, workspaceId);
  if (!config) return { ok: false, status: 404, body: { error: 'SSO is not configured for this workspace', code: 'NOT_FOUND' } };
  return { ok: true, status: 200, body: view(env, config) };
}

export async function putWorkspaceSso(
  env: Env,
  actor: { id: string; email: string },
  workspaceId: string,
  body: Record<string, unknown>,
): Promise<ProvisionResult> {
  const input: SsoConfigInput = {
    issuer: typeof body.issuer === 'string' ? body.issuer : undefined,
    client_id: typeof body.client_id === 'string' ? body.client_id : undefined,
    client_secret: typeof body.client_secret === 'string' ? body.client_secret : undefined,
    email_domains: Array.isArray(body.email_domains) ? body.email_domains.map(String) : undefined,
    button_label: typeof body.button_label === 'string' ? body.button_label : null,
    enforced: body.enforced === true,
  };

  // Fail at save time, not on the first employee's login: the issuer must serve a
  // discovery document that names itself.
  const issuer = normalizeIssuer(input.issuer || '');
  if (issuer) {
    try {
      await discover(issuer);
    } catch (err: any) {
      return { ok: false, status: 400, body: { error: err?.message || 'OIDC discovery failed', code: 'ISSUER_UNREACHABLE' } };
    }
  }

  const result = await upsertSsoConfig(env, workspaceId, actor.id, input);
  if (!result.ok) return { ok: false, status: result.status, body: { error: result.error, code: result.code } };

  await logAudit(env, {
    workspaceId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'workspace.sso_set',
    targetType: 'workspace',
    targetId: workspaceId,
    detail: {
      issuer: result.config.issuer,
      email_domains: result.config.emailDomains,
      enforced: result.config.enforced,
      client_secret_rotated: Boolean(input.client_secret),
    },
  });
  return { ok: true, status: 200, body: view(env, result.config) };
}

export async function deleteWorkspaceSso(
  env: Env,
  actor: { id: string; email: string },
  workspaceId: string,
): Promise<ProvisionResult> {
  if (!(await deleteSsoConfig(env, workspaceId))) {
    return { ok: false, status: 404, body: { error: 'SSO is not configured for this workspace', code: 'NOT_FOUND' } };
  }
  await logAudit(env, {
    workspaceId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'workspace.sso_remove',
    targetType: 'workspace',
    targetId: workspaceId,
  });
  return { ok: true, status: 200, body: { ok: true } };
}
