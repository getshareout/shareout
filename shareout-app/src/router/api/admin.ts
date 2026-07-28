import type { FetchContext } from '../context';
import { jsonResponse, jsonError } from '../helpers/json-response';
import { requireSuperAdmin } from '../../superadmin/auth';
import {
  listUsers,
  getUserDetail,
  setUserTier,
  revokeUserAccess,
  deleteUser,
} from '../../superadmin/users';
import {
  searchArtifacts,
  setArtifactPaused,
  setArtifactVisibility,
  deleteArtifactAdmin,
  listModerationQueue,
  setArtifactModeration,
} from '../../superadmin/artifacts-admin';
import { listAbuseReports } from '../../moderation/abuse-reports';
import { userRow, artifactRow, renderAdminFragment } from '../../superadmin/page';
import { searchWorkspaces } from '../../superadmin/workspaces-admin';
import { provisionWorkspace, setWorkspaceMemberRole } from '../../superadmin/workspaces-provision';
import { buildInstanceConfig } from '../../superadmin/instance-config';
import { renderFeatureGrid } from '../../superadmin/features-view';
import { isKnownFeature } from '../../features/registry';
import { setGlobalFlag, setWorkspaceFlag, GLOBAL_TARGET } from '../../features/flags';
import { defaultReportDate, getDailyPlatformDigest } from '../../superadmin/digest';
import { backfillVectors } from '../../search/semantic';

export async function routeAdminApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, url } = ctx;
  if (!path.startsWith('/v1/admin/')) return null;

  const admin = await requireSuperAdmin(request, env);
  if (!admin) return jsonError('Forbidden', 'FORBIDDEN', 403);

  // POST /v1/admin/vectorize/backfill — embed all live artifacts into the semantic index.
  if (path === '/v1/admin/vectorize/backfill' && request.method === 'POST') {
    return jsonResponse(await backfillVectors(env));
  }

  // GET /v1/admin/metrics/daily?date=YYYY-MM-DD — structured daily platform digest (default: yesterday UTC)
  if (path === '/v1/admin/metrics/daily' && request.method === 'GET') {
    const dateParam = url.searchParams.get('date')?.trim() || '';
    const reportDate =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : defaultReportDate();
    return jsonResponse(await getDailyPlatformDigest(env, reportDate));
  }

  // GET /v1/admin/view?view=&range= — content fragment for client-side nav
  if (path === '/v1/admin/view' && request.method === 'GET') {
    const view = url.searchParams.get('view') || 'overview';
    const range = url.searchParams.get('range') || '30';
    return jsonResponse(await renderAdminFragment(env, view, range));
  }

  // GET /v1/admin/users?search=
  if (path === '/v1/admin/users' && request.method === 'GET') {
    const search = url.searchParams.get('search')?.trim() || '';
    const { users, total } = await listUsers(env, search, 50, 0);
    return jsonResponse({ rows: users.map(userRow).join(''), total });
  }

  // GET /v1/admin/artifacts?search=
  if (path === '/v1/admin/artifacts' && request.method === 'GET') {
    const search = url.searchParams.get('search')?.trim() || '';
    const { artifacts, total } = await searchArtifacts(env, search, 50, 0);
    return jsonResponse({ rows: artifacts.map(artifactRow).join(''), total });
  }

  // GET /v1/admin/workspaces?search= — workspace picker for the Features view
  if (path === '/v1/admin/workspaces' && request.method === 'GET') {
    const search = url.searchParams.get('search')?.trim() || '';
    const { workspaces, total } = await searchWorkspaces(env, search, 20, 0);
    return jsonResponse({ workspaces, total });
  }

  // GET /v1/admin/instance — what this instance is configured for, and what each
  // unset thing disables. No secrets, only whether each is present.
  if (path === '/v1/admin/instance' && request.method === 'GET') {
    return jsonResponse(await buildInstanceConfig(env));
  }

  // POST /v1/admin/workspaces {name, owner_email, slug?, description?}
  // Stand up a workspace for someone else. The owner does not have to exist yet —
  // they land in it on first sign-in.
  if (path === '/v1/admin/workspaces' && request.method === 'POST') {
    const body = await request.json<{ name?: string; slug?: string; description?: string; owner_email?: string }>()
      .catch(() => ({}));
    const result = await provisionWorkspace(env, admin, body, ctx.executionCtx);
    return jsonResponse(result.body, result.status);
  }

  // POST /v1/admin/workspaces/{id}/members {email, role}
  // Appoint an owner/admin/member without being a member of that workspace.
  const wsMemberMatch = path.match(/^\/v1\/admin\/workspaces\/([^/]+)\/members$/);
  if (wsMemberMatch && request.method === 'POST') {
    const body = await request.json<{ email?: string; role?: string }>().catch(() => ({}));
    const result = await setWorkspaceMemberRole(env, admin, wsMemberMatch[1], body);
    return jsonResponse(result.body, result.status);
  }

  // GET /v1/admin/features?target=global|<workspaceId> — feature grid fragment
  if (path === '/v1/admin/features' && request.method === 'GET') {
    const target = url.searchParams.get('target') || GLOBAL_TARGET;
    return jsonResponse({ target, html: await renderFeatureGrid(env, target) });
  }

  // POST /v1/admin/features {target, key, value:true|false|null} — set/clear an override
  if (path === '/v1/admin/features' && request.method === 'POST') {
    const body = await request.json<{ target?: string; key?: string; value?: boolean | null }>()
      .catch(() => ({}) as { target?: string; key?: string; value?: boolean | null });
    const target = body.target || '';
    const key = body.key || '';
    const value = body.value === true ? true : body.value === false ? false : null;
    if (!isKnownFeature(key)) return jsonError('Unknown feature', 'INVALID_FEATURE', 400);
    if (!target) return jsonError('target required', 'INVALID_TARGET', 400);
    if (target === GLOBAL_TARGET) {
      await setGlobalFlag(env, key, value);
    } else {
      await setWorkspaceFlag(env, target, key, value);
    }
    return jsonResponse({ target, html: await renderFeatureGrid(env, target) });
  }

  if (path === '/v1/admin/moderation' && request.method === 'GET') {
    return jsonResponse({ queue: await listModerationQueue(env) });
  }

  if (path === '/v1/admin/abuse' && request.method === 'GET') {
    return jsonResponse({ reports: await listAbuseReports(env) });
  }

  const artMatch = path.match(/^\/v1\/admin\/artifacts\/([^/]+)(\/pause|\/visibility|\/moderation)?$/);
  if (artMatch) {
    const [, artifactId, artAction] = artMatch;

    if (!artAction && request.method === 'DELETE') {
      const result = await deleteArtifactAdmin(env, artifactId);
      if (!result.ok) return jsonError(result.error || 'Delete failed', 'DELETE_FAILED', 400);
      return jsonResponse({ ok: true });
    }

    if (artAction === '/pause' && request.method === 'POST') {
      const body = await request.json<{ paused?: boolean }>().catch(() => ({}) as { paused?: boolean });
      await setArtifactPaused(env, artifactId, body.paused !== false);
      return jsonResponse({ ok: true });
    }

    if (artAction === '/moderation' && request.method === 'POST') {
      const body = await request.json<{ action?: string; reason?: string }>().catch(() => ({}) as { action?: string; reason?: string });
      if (body.action !== 'approve' && body.action !== 'block') {
        return jsonError('action must be approve or block', 'INVALID_ACTION', 400);
      }
      const result = await setArtifactModeration(env, artifactId, body.action, body.reason);
      if (!result.ok) return jsonError(result.error || 'Moderation failed', 'MODERATION_FAILED', 400);
      return jsonResponse({ ok: true });
    }

    if (artAction === '/visibility' && request.method === 'POST') {
      const body = await request.json<{ visibility?: string }>().catch(() => ({}) as { visibility?: string });
      const result = await setArtifactVisibility(env, artifactId, body.visibility || '');
      if (!result.ok) return jsonError(result.error || 'Invalid visibility', 'INVALID_VISIBILITY', 400);
      return jsonResponse({ ok: true });
    }
  }

  const userMatch = path.match(/^\/v1\/admin\/users\/([^/]+)(\/tier|\/revoke)?$/);
  if (userMatch) {
    const [, userId, action] = userMatch;

    if (!action && request.method === 'GET') {
      const detail = await getUserDetail(env, userId);
      if (!detail) return jsonError('User not found', 'NOT_FOUND', 404);
      return jsonResponse(detail);
    }

    if (!action && request.method === 'DELETE') {
      const result = await deleteUser(env, userId);
      if (!result.ok) return jsonError(result.error || 'Delete failed', 'DELETE_FAILED', 400);
      return jsonResponse({ ok: true });
    }

    if (action === '/tier' && request.method === 'POST') {
      const body = await request.json<{ tier?: string }>().catch(() => ({}) as { tier?: string });
      const result = await setUserTier(env, userId, body.tier || '');
      if (!result.ok) return jsonError(result.error || 'Invalid tier', 'INVALID_TIER', 400);
      return jsonResponse({ ok: true });
    }

    if (action === '/revoke' && request.method === 'POST') {
      const body = await request.json<{ disabled?: boolean }>().catch(() => ({}) as { disabled?: boolean });
      await revokeUserAccess(env, userId, body.disabled !== false);
      return jsonResponse({ ok: true });
    }
  }

  return jsonError('Not found', 'NOT_FOUND', 404);
}
