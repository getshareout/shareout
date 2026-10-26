// Catalog metrics: the executable `kind: metric` entries of a workspace's catalog.
//
//   GET  /v1/workspaces/{id}/catalog/metrics               list (any internal member)
//   GET  /v1/workspaces/{id}/catalog/metrics/{id}          one metric
//   POST /v1/workspaces/{id}/catalog/metrics/{id}/query    run it ({ grain, by, from, to, where })
//   GET  /v1/workspaces/{id}/catalog/metrics/{id}/explain  the formula; the SQL for owners/admins
import type { FetchContext } from '../context';
import { jsonError, jsonResponse } from '../helpers/json-response';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { apiErrorResponse } from '../../http/api-error';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { isCatalogEnabled } from '../../catalog/store';
import {
  getCatalogMetric,
  listCatalogMetrics,
  metricDetail,
  metricFreshness,
  prepareMetricQuery,
  runCatalogMetric,
  type MetricFailure,
} from '../../catalog/metrics/run';
import { metricFormula } from '../../catalog/metrics/spec';

const METRICS_RE = /^\/v1\/workspaces\/([^/]+)\/catalog\/metrics(?:\/([^/]+)(?:\/(query|explain))?)?\/?$/;

function failureResponse(f: MetricFailure): Response {
  const res = apiErrorResponse({
    code: f.code,
    message: f.message,
    status: f.status,
    ...(f.hint ? { hint: f.hint } : {}),
    ...(f.param ? { param: f.param } : {}),
  });
  if (f.retryAfter) res.headers.set('Retry-After', String(f.retryAfter));
  return res;
}

/** explain's query comes from the URL: ?grain=month&by=canal,cliente&from=…&to=… */
function queryFromUrl(url: URL): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const key of ['grain', 'from', 'to'] as const) {
    const v = url.searchParams.get(key);
    if (v) q[key] = v;
  }
  const by = url.searchParams.get('by');
  if (by) q.by = by.split(',').map(s => s.trim()).filter(Boolean);
  return q;
}

export async function routeCatalogMetricsApi(ctx: FetchContext): Promise<Response | null> {
  const match = ctx.path.match(METRICS_RE);
  if (!match) return null;
  const cors = (r: Response) => ctx.addCORS(r);
  const [, workspaceId, rawId, action] = match;
  const method = ctx.request.method;

  const auth = await requireTokenOrSession(ctx);
  if (!isAuthUser(auth)) return auth;
  const role = await getInternalWorkspaceRole(ctx.env, workspaceId, auth.id);
  if (!role) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));

  const expected = action === 'query' ? 'POST' : 'GET';
  if (method !== expected) return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));

  const enabled = await isCatalogEnabled(ctx.env, workspaceId);
  if (!rawId) {
    if (!enabled) return cors(jsonResponse({ enabled: false, metrics: [] }));
    return cors(jsonResponse({ enabled: true, metrics: await listCatalogMetrics(ctx.env, workspaceId, role, auth.id) }));
  }
  if (!enabled) {
    return cors(apiErrorResponse({ code: 'CATALOG_DISABLED', message: 'This workspace has no data catalog', status: 409 }));
  }
  const metricId = decodeURIComponent(rawId);

  if (action === 'query') {
    const body = await ctx.request.json().catch(() => ({}));
    const result = await runCatalogMetric(ctx.env, { workspaceId, userId: auth.id, role, metricId, query: body ?? {} });
    return cors(result.ok ? jsonResponse(result.body) : failureResponse(result));
  }

  if (action === 'explain') {
    const prepared = await prepareMetricQuery(ctx.env, { workspaceId, metricId, query: queryFromUrl(ctx.url) });
    if (!prepared.ok) return cors(failureResponse(prepared));
    const manager = role === 'owner' || role === 'admin';
    return cors(
      jsonResponse({
        metric: prepared.metric.entry.id,
        formula: metricFormula(prepared.spec),
        query: prepared.query,
        dialect: prepared.target.dialect,
        ...(manager ? { sql: prepared.compiled.sql } : {}),
      })
    );
  }

  const got = await getCatalogMetric(ctx.env, workspaceId, metricId);
  if (!got.ok) return cors(failureResponse(got));
  const freshness = await metricFreshness(ctx.env, workspaceId, got.metric);
  return cors(jsonResponse({ enabled: true, metric: { ...metricDetail(got.metric, role, auth.id), freshness } }));
}
