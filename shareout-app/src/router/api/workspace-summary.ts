import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { jsonWithApiErrors as json } from '../../http/api-error';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { isPlatformAdmin } from '../../superadmin/auth';
import { workspaceMarkup } from '../../data/ai-markup';
import { logAudit } from '../../audit';
import {
  MAX_SUMMARY_VIEWERS, SummaryViewersError, getUsageSummary, isSummaryMonth, isSummaryViewer, listSummaryViewers, setSummaryViewers,
} from '../../workspaces/usage-summary';

// Admin → Summary (src/workspaces/usage-summary.ts): the month-by-month usage report. Only the owner,
// the admins the owner listed and the instance operator open it — not every admin. People only:
// agent tokens are refused.
//
//   GET /v1/workspaces/{ws}/summary?month=YYYY-MM   the report (default: this month)
//   GET /v1/workspaces/{ws}/summary/access          { can_view, can_manage } — drives the sidebar entry
//   GET /v1/workspaces/{ws}/summary/viewers         owner + admins, each with can_view (owner, operator)
//   PUT /v1/workspaces/{ws}/summary/viewers         { user_ids: [...] } replaces the list (owner, operator)

const FORBIDDEN = { error: 'Forbidden', code: 'FORBIDDEN' };

export interface SummaryAccess { canView: boolean; canManage: boolean }

export async function summaryAccess(env: Env, user: AuthUser, workspaceId: string): Promise<SummaryAccess> {
  if (user.service) return { canView: false, canManage: false };
  if (await isPlatformAdmin(env, user.email, user.id)) {
    const exists = await env.DB.prepare('SELECT 1 AS ok FROM workspaces WHERE id = ?').bind(workspaceId).first();
    return { canView: !!exists, canManage: !!exists };
  }
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (role === 'owner') return { canView: true, canManage: true };
  if (role === 'admin') return { canView: await isSummaryViewer(env, workspaceId, user.id), canManage: false };
  return { canView: false, canManage: false };
}

export async function handleGetSummary(request: Request, env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  const access = await summaryAccess(env, user, workspaceId);
  if (!access.canView) return json(FORBIDDEN, 403);
  const month = new URL(request.url).searchParams.get('month') || new Date().toISOString().slice(0, 7);
  if (!isSummaryMonth(month)) return json({ error: 'month must be YYYY-MM', code: 'INVALID_MONTH' }, 400);
  const { bps } = await workspaceMarkup(env, workspaceId);
  return json({ ...(await getUsageSummary(env, workspaceId, month, bps)), can_manage: access.canManage });
}

export async function handleGetSummaryAccess(env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  const a = await summaryAccess(env, user, workspaceId);
  return json({ can_view: a.canView, can_manage: a.canManage });
}

export async function handleGetSummaryViewers(env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  if (!(await summaryAccess(env, user, workspaceId)).canManage) return json(FORBIDDEN, 403);
  return json({ viewers: await listSummaryViewers(env, workspaceId), max: MAX_SUMMARY_VIEWERS });
}

export async function handleSetSummaryViewers(request: Request, env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  if (!(await summaryAccess(env, user, workspaceId)).canManage) return json(FORBIDDEN, 403);
  const body = (await request.json().catch(() => null)) as { user_ids?: unknown } | null;
  const ids = body?.user_ids;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string' && x.length > 0 && x.length < 100)) {
    return json({ error: 'Send { "user_ids": ["usr_…"] }', code: 'VALIDATION_ERROR' }, 400);
  }
  try {
    const { added, removed } = await setSummaryViewers(env, workspaceId, ids as string[], user.id);
    if (added.length || removed.length) {
      await logAudit(env, {
        workspaceId, actorId: user.id, actorEmail: user.email, action: 'summary.viewers_update',
        targetType: 'workspace', targetId: workspaceId, detail: { added, removed },
      });
    }
  } catch (err) {
    if (err instanceof SummaryViewersError) return json({ error: err.message, code: 'VALIDATION_ERROR' }, 400);
    throw err;
  }
  return json({ viewers: await listSummaryViewers(env, workspaceId), max: MAX_SUMMARY_VIEWERS });
}

/** Router for /v1/workspaces/{ws}/summary… — null when the path is not ours. */
export async function routeWorkspaceSummary(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;
  const m = path.match(/^\/v1\/workspaces\/([^/]+)\/summary(?:\/(access|viewers))?$/);
  if (!m) return null;
  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;
  const ws = decodeURIComponent(m[1]!);
  const sub = m[2];
  const method = request.method;
  if (!sub && method === 'GET') return addCORS(await handleGetSummary(request, env, user, ws));
  if (sub === 'access' && method === 'GET') return addCORS(await handleGetSummaryAccess(env, user, ws));
  if (sub === 'viewers' && method === 'GET') return addCORS(await handleGetSummaryViewers(env, user, ws));
  if (sub === 'viewers' && method === 'PUT') return addCORS(await handleSetSummaryViewers(request, env, user, ws));
  return addCORS(json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405));
}
