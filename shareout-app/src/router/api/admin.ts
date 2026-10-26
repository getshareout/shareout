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
import { userRow, artifactRow } from '../../superadmin/views/rows';
import { renderAdminFragment } from '../../superadmin/page';
import { searchWorkspaces } from '../../superadmin/workspaces-admin';
import { provisionWorkspace, setWorkspaceMemberRole } from '../../superadmin/workspaces-provision';
import { parseProvisionSpec } from '../../superadmin/provision/spec';
import { runProvisioning } from '../../superadmin/provision/run';
import { apiErrorResponse } from '../../http/api-error';
import { buildInstanceConfig } from '../../superadmin/instance-config';
import { getWorkspaceSso, putWorkspaceSso, deleteWorkspaceSso } from '../../superadmin/workspace-sso';
import { getInstanceDefaultGatewayModel } from '../../data/agent/ai-config';
import { renderFeatureGrid } from '../../superadmin/features-view';
import { isKnownFeature } from '../../features/registry';
import { setGlobalFlag, setWorkspaceFlag, GLOBAL_TARGET } from '../../features/flags';
import { defaultReportDate, getDailyPlatformDigest } from '../../superadmin/digest';
import { backfillVectors } from '../../search/semantic';
import { startVectorBackfills, v2Problem } from '../../knowledge/vectors/backfill';
import { v2Target } from '../../knowledge/vectors/models';
import { runSummaryBackfill } from '../../publish/summary-backfill';
import {
  dailyUsageCsv,
  getDailyUsage,
  getMonthlyUsage,
  previousMonth,
  rollupWorkspaceUsage,
  usageCsv,
  utcDay,
} from '../../workspaces/usage-ledger';

export async function routeAdminApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, url } = ctx;
  if (!path.startsWith('/v1/admin/')) return null;

  const admin = await requireSuperAdmin(request, env);
  if (!admin) return jsonError('Forbidden', 'FORBIDDEN', 403);

  // POST /v1/admin/vectorize/backfill — embed all live artifacts into the semantic index.
  if (path === '/v1/admin/vectorize/backfill' && request.method === 'POST') {
    return jsonResponse(await backfillVectors(env));
  }

  // POST /v1/admin/knowledge/vectors/backfill?after=<workspace id>&limit=10[&reset=1] — start the
  // multilingual-index backfill (a paced Workflow each) for the next `limit` workspaces by id.
  // Call again with after=<next> until next is null; a rerun only embeds what is missing.
  if (path === '/v1/admin/knowledge/vectors/backfill' && request.method === 'POST') {
    if (!v2Target(env)) {
      return apiErrorResponse({ message: 'The multilingual index is not configured', code: 'NOT_CONFIGURED', status: 501, hint: v2Problem(env) ?? 'Bind KNOWLEDGE_VECTORS_V2, a 1024-d cosine Vectorize index (see wrangler.toml), and redeploy.' });
    }
    if (!env.KNOWLEDGE_INGEST) {
      return apiErrorResponse({ message: 'Instance-wide backfill needs Workflows (KNOWLEDGE_INGEST)', code: 'NOT_CONFIGURED', status: 501, hint: 'Call POST /v1/workspaces/{id}/knowledge/vectors/backfill per workspace instead.' });
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 25);
    const after = url.searchParams.get('after')?.trim() || '';
    const r = await startVectorBackfills(env, { after, limit, reset: url.searchParams.get('reset') === '1' });
    return jsonResponse({ started: r.instances.length, instances: r.instances, next: r.next }, 202);
  }

  // POST /v1/admin/summaries/backfill?workspace_id=…&limit=25 — one batch of the hourly
  // TL;DR drip, now, for one workspace. Call again until processed is 0.
  if (path === '/v1/admin/summaries/backfill' && request.method === 'POST') {
    const workspaceId = url.searchParams.get('workspace_id')?.trim();
    if (!workspaceId) return jsonError('workspace_id is required', 'VALIDATION_ERROR', 400);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 25, 1), 50);
    return jsonResponse(await runSummaryBackfill(env, { workspaceId, limit }));
  }

  // GET /v1/admin/metrics/daily?date=YYYY-MM-DD — structured daily platform digest (default: yesterday UTC)
  if (path === '/v1/admin/metrics/daily' && request.method === 'GET') {
    const dateParam = url.searchParams.get('date')?.trim() || '';
    const reportDate =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : defaultReportDate();
    return jsonResponse(await getDailyPlatformDigest(env, reportDate));
  }

  // GET /v1/admin/usage.csv?month=YYYY-MM[&by=day] — per-workspace usage + cost for a
  // month (default: last month), monthly totals or one row per day.
  if (path === '/v1/admin/usage.csv' && request.method === 'GET') {
    const monthParam = url.searchParams.get('month')?.trim() || '';
    const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : previousMonth();
    const byDay = url.searchParams.get('by') === 'day';
    const csv = byDay ? dailyUsageCsv(await getDailyUsage(env, month)) : usageCsv(month, await getMonthlyUsage(env, month));
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="shareout-usage-${month}${byDay ? '-daily' : ''}.csv"`,
      },
    });
  }

  // POST /v1/admin/usage/rollup {day: YYYY-MM-DD} — (re)build one day of the usage
  // ledger. Storage is measured only for yesterday or today (R2 has no history).
  if (path === '/v1/admin/usage/rollup' && request.method === 'POST') {
    const body = await request.json<{ day?: string }>().catch(() => ({}) as { day?: string });
    const day = body.day?.trim() || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
      return jsonError('day must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
    }
    const today = utcDay();
    if (day > today) return jsonError('day is in the future', 'VALIDATION_ERROR', 400);
    const measureStorage = day >= utcDay(new Date(Date.now() - 86_400_000));
    return jsonResponse({ ...(await rollupWorkspaceUsage(env, day, { measureStorage })), measureStorage });
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

  // GET/PUT /v1/admin/ai-settings — instance-wide default Vercel AI Gateway model.
  // A workspace's own `gateway_model` (workspace-llm.ts) takes priority over this.
  if (path === '/v1/admin/ai-settings' && request.method === 'GET') {
    return jsonResponse({ defaultGatewayModel: await getInstanceDefaultGatewayModel(env) });
  }
  if (path === '/v1/admin/ai-settings' && request.method === 'PUT') {
    const body = await request.json<{ defaultGatewayModel?: string | null }>().catch(() => ({}) as { defaultGatewayModel?: string | null });
    const model = body.defaultGatewayModel;
    if (model !== null && (!model || typeof model !== 'string' || !model.includes('/'))) {
      return jsonError('defaultGatewayModel must be a gateway model id or null', 'VALIDATION_ERROR', 400);
    }
    await env.DB.prepare(`
      INSERT INTO instance_ai_settings (id, default_gateway_model, updated_at)
      VALUES (1, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(id) DO UPDATE SET
        default_gateway_model = excluded.default_gateway_model,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `).bind(model).run();
    return jsonResponse({ ok: true, defaultGatewayModel: model });
  }

  // POST /v1/admin/workspaces/provision — one-step customer workspace: create (or adopt by
  // slug), branding, policy, starter folders, first admins, connectors, template/domain
  // hooks. Idempotent; 201 created, 200 re-run, 207 when a step failed (see `steps`).
  if (path === '/v1/admin/workspaces/provision' && request.method === 'POST') {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return apiErrorResponse({ code: 'INVALID_JSON', message: 'Body must be JSON', status: 400 });
    }
    const parsed = parseProvisionSpec(raw);
    if (!parsed.ok) return apiErrorResponse({ ...parsed.error, status: 400, docs: 'https://docs.shareout.site/self-host/ops/#provision-a-customer-workspace' });
    const outcome = await runProvisioning(env, admin, parsed.spec, ctx.executionCtx);
    if (!outcome.ok) return apiErrorResponse({ code: outcome.code, message: outcome.message, hint: outcome.hint, status: outcome.status, param: 'slug' });
    return jsonResponse(outcome.summary, outcome.status);
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

  // GET|PUT|DELETE /v1/admin/workspaces/{id}/sso — the workspace's OIDC sign-in (Okta, …).
  // Instance-owner only: the IdP asserts emails on `email_domains`, so letting a workspace
  // admin set it would let them sign in as anyone on those domains.
  const wsSsoMatch = path.match(/^\/v1\/admin\/workspaces\/([^/]+)\/sso$/);
  if (wsSsoMatch && request.method === 'GET') {
    const result = await getWorkspaceSso(env, wsSsoMatch[1]);
    return jsonResponse(result.body, result.status);
  }
  if (wsSsoMatch && request.method === 'PUT') {
    const body = await request.json<Record<string, unknown>>().catch(() => ({}));
    const result = await putWorkspaceSso(env, admin, wsSsoMatch[1], body);
    return jsonResponse(result.body, result.status);
  }
  if (wsSsoMatch && request.method === 'DELETE') {
    const result = await deleteWorkspaceSso(env, admin, wsSsoMatch[1]);
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
