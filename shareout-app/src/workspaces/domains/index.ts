/**
 * Workspace custom domains — the public surface of this module.
 *
 *   GET    /v1/workspaces/{id}/domains                      list + mode + CNAME target
 *   POST   /v1/workspaces/{id}/domains        {hostname}    add (pending until verified)
 *   POST   /v1/workspaces/{id}/domains/{did}/refresh        re-check DNS / Cloudflare
 *   PATCH  /v1/workspaces/{id}/domains/{did}  {primary}     set / unset primary
 *   DELETE /v1/workspaces/{id}/domains/{did}                remove (and from Cloudflare)
 *
 * Owners and admins only. `provisionWorkspaceDomain` is the same add path for trusted
 * server-side callers (workspace provisioning), without the role check.
 */
import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { jsonWithApiErrors as json } from '../../http/api-error';
import { requireWorkspaceRole } from '../roles';
import { logAudit } from '../../audit';
import { cnameTarget, customDomainsEnabled } from './hostname';
import {
  addDomain, DomainError, listDomains, refreshDomain, refreshPendingDomains, removeDomain, setPrimaryDomain, toView, type DomainView,
} from './store';

export { releaseWorkspaceDomains } from './store';
export { workspaceArtifactUrl, workspaceOrigin, workspacePrimaryHost } from './links';

function mode(env: Env): 'cloudflare' | 'manual' {
  return env.CF_CUSTOM_HOSTNAMES_TOKEN && env.CF_CUSTOM_HOSTNAMES_ZONE_ID ? 'cloudflare' : 'manual';
}

function errorResponse(err: unknown): Response {
  if (err instanceof DomainError) {
    return json({ error: err.message, code: err.code, ...(err.hint ? { hint: err.hint } : {}) }, err.status);
  }
  throw err;
}

function disabled(): Response {
  return json({
    error: 'Custom domains are not enabled on this instance.',
    code: 'CUSTOM_DOMAINS_DISABLED',
    hint: 'The instance operator sets CUSTOM_DOMAINS_CNAME_TARGET (manual DNS mode) or CF_CUSTOM_HOSTNAMES_TOKEN + CF_CUSTOM_HOSTNAMES_ZONE_ID (Cloudflare for SaaS).',
  }, 409);
}

/**
 * Provisioning hook: claim `hostname` for a workspace from trusted server code (no
 * role check — the caller is the platform). Returns the domain with the DNS records
 * the customer must add. Throws DomainError (status/code/message) on refusal.
 */
export async function provisionWorkspaceDomain(
  env: Env,
  input: { workspaceId: string; hostname: string; actorId?: string | null; primary?: boolean },
): Promise<DomainView> {
  if (!customDomainsEnabled(env)) {
    throw new DomainError(409, 'CUSTOM_DOMAINS_DISABLED', 'Custom domains are not enabled on this instance.');
  }
  const { row, created } = await addDomain(env, { workspaceId: input.workspaceId, hostname: input.hostname, actorId: input.actorId ?? null });
  if (created) {
    await logAudit(env, {
      workspaceId: input.workspaceId, actorId: input.actorId ?? null, action: 'domain.add',
      targetType: 'workspace_domain', targetId: row.id, detail: { hostname: row.hostname, via: 'provisioning' },
    });
  }
  // Primary only takes once the hostname is active; a pending one is just recorded.
  if (input.primary && row.status === 'active') await setPrimaryDomain(env, input.workspaceId, row.id);
  return toView(env, row);
}

export { DomainError };

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }
}

async function listPayload(env: Env, workspaceId: string) {
  const rows = await listDomains(env, workspaceId);
  return {
    enabled: customDomainsEnabled(env),
    mode: mode(env),
    cname_target: cnameTarget(env),
    domains: rows.map((r) => toView(env, r)),
  };
}

export async function routeWorkspaceDomainsApi(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  rest: string,
): Promise<Response | null> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;
  const audit = (action: string, targetId: string, detail: Record<string, unknown>) => logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email, action, targetType: 'workspace_domain', targetId, detail,
  });

  try {
    if (rest === '' && request.method === 'GET') {
      const url = new URL(request.url);
      if (url.searchParams.get('refresh') === '1' && customDomainsEnabled(env)) await refreshPendingDomains(env, workspaceId);
      return json(await listPayload(env, workspaceId));
    }
    if (rest === '' && request.method === 'POST') {
      if (!customDomainsEnabled(env)) return disabled();
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const { row, created } = await addDomain(env, { workspaceId, hostname: body.hostname, actorId: user.id });
      if (created) await audit('domain.add', row.id, { hostname: row.hostname, provider: row.provider });
      return json({ domain: toView(env, row) }, created ? 201 : 200);
    }

    const m = rest.match(/^\/([^/]+)(\/refresh)?$/);
    if (!m) return null;
    const domainId = decodeURIComponent(m[1]!);
    if (m[2]) {
      if (request.method !== 'POST') return null;
      const row = await refreshDomain(env, workspaceId, domainId);
      return json({ domain: toView(env, row) });
    }
    if (request.method === 'PATCH' || request.method === 'PUT') {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      if (typeof body.primary !== 'boolean') {
        return json({ error: 'primary must be true or false', code: 'VALIDATION_ERROR', param: 'primary' }, 400);
      }
      await setPrimaryDomain(env, workspaceId, body.primary ? domainId : null);
      await audit(body.primary ? 'domain.primary_set' : 'domain.primary_unset', domainId, {});
      return json(await listPayload(env, workspaceId));
    }
    if (request.method === 'DELETE') {
      const row = await removeDomain(env, workspaceId, domainId);
      await audit('domain.remove', row.id, { hostname: row.hostname });
      return json({ success: true, removed: row.hostname });
    }
    return null;
  } catch (err) {
    return errorResponse(err);
  }
}
