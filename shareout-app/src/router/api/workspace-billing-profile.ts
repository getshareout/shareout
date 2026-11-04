import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { jsonWithApiErrors as json } from '../../http/api-error';
import { requireWorkspaceRole } from '../../workspaces/roles';
import { isPlatformAdmin } from '../../superadmin/auth';
import { logAudit } from '../../audit';
import {
  TAX_CONDITIONS, formatCuit, getBillingProfile, parseBillingProfile, saveBillingProfile, type BillingProfile, type StoredBillingProfile,
} from '../../workspaces/billing-profile';

// Billing details (src/workspaces/billing-profile.ts): who the workspace's invoices are made out to.
// Its owners and admins read and edit them; so does the instance operator, who bills from them.
// People only: agent tokens are refused.
//
//   GET /v1/workspaces/{ws}/billing-profile   { profile | null, can_edit, tax_conditions }
//   PUT /v1/workspaces/{ws}/billing-profile   the whole profile; 400 lists each refused field

const FORBIDDEN = { error: 'Forbidden', code: 'FORBIDDEN' };

async function gate(env: Env, user: AuthUser, workspaceId: string): Promise<Response | null> {
  if (user.service) return json(FORBIDDEN, 403);
  if (await isPlatformAdmin(env, user.email, user.id)) {
    const exists = await env.DB.prepare('SELECT 1 AS ok FROM workspaces WHERE id = ?').bind(workspaceId).first();
    return exists ? null : json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);
  }
  return requireWorkspaceRole(env, workspaceId, user.id, 'admin');
}

const view = (p: StoredBillingProfile | null) => p && { ...p, tax_id_display: p.country === 'AR' ? formatCuit(p.tax_id ?? '') : p.tax_id };

export async function handleGetBillingProfile(env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  const denied = await gate(env, user, workspaceId);
  if (denied) return denied;
  return json({ profile: view(await getBillingProfile(env, workspaceId)), can_edit: true, tax_conditions: TAX_CONDITIONS });
}

export async function handlePutBillingProfile(request: Request, env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  const denied = await gate(env, user, workspaceId);
  if (denied) return denied;
  const parsed = parseBillingProfile(await request.json().catch(() => null));
  if ('errors' in parsed) {
    // `success` keeps the body as-is so the form gets `fields` (the API-error envelope would drop it).
    return json({ success: false, error: 'Some billing details need fixing', code: 'VALIDATION_ERROR', fields: parsed.errors }, 400);
  }
  const before = await getBillingProfile(env, workspaceId);
  await saveBillingProfile(env, workspaceId, parsed.profile, user.id);
  const changed = (Object.keys(parsed.profile) as (keyof BillingProfile)[]).filter((k) => (before?.[k] ?? null) !== (parsed.profile[k] ?? null));
  if (changed.length) {
    await logAudit(env, {
      workspaceId, actorId: user.id, actorEmail: user.email, action: 'billing_profile.update',
      targetType: 'workspace', targetId: workspaceId, detail: { fields: changed },
    });
  }
  return json({ profile: view(await getBillingProfile(env, workspaceId)), can_edit: true, tax_conditions: TAX_CONDITIONS });
}

/** Router for /v1/workspaces/{ws}/billing-profile — null when the path is not ours. */
export async function routeWorkspaceBillingProfile(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;
  const m = path.match(/^\/v1\/workspaces\/([^/]+)\/billing-profile$/);
  if (!m) return null;
  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;
  const ws = decodeURIComponent(m[1]!);
  if (request.method === 'GET') return addCORS(await handleGetBillingProfile(env, user, ws));
  if (request.method === 'PUT') return addCORS(await handlePutBillingProfile(request, env, user, ws));
  return addCORS(json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405));
}
