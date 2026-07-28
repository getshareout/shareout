import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { createWatch, listWatches, deleteWatch } from '../../metric-watch/watches';
import { jsonWithApiErrors } from '../../http/api-error';

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function errorJson(error: string): Response {
  const status = /not found/i.test(error) ? 404 : /permission|denied/i.test(error) ? 403 : 400;
  return json({ error }, status);
}

/**
 * One-click Metric Watch API. Watches are account/product objects (like
 * /v1/metric-alerts): they accept a ShareOut API token or a browser session so
 * the home, artifact toolbar, and chat agent can all manage them.
 *   POST   /v1/metric-watch            { artifact_id, table, kind, column?, threshold_pct? }
 *   GET    /v1/metric-watch?artifact_id=…
 *   DELETE /v1/metric-watch/:id
 */
export async function routeMetricWatchApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, url, addCORS } = ctx;
  if (!path.startsWith('/v1/metric-watch')) return null;

  if (path === '/v1/metric-watch') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      const artifactId = url.searchParams.get('artifact_id');
      if (!artifactId) return addCORS(json({ error: 'artifact_id query param required' }, 400));
      const result = await listWatches(env, user.id, artifactId);
      return addCORS(result.error ? errorJson(result.error) : json({ watches: result.watches }));
    }
    if (request.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return addCORS(json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400));
      }
      const artifactId = body.artifact_id as string;
      if (!artifactId) return addCORS(json({ error: 'artifact_id required' }, 400));
      const result = await createWatch(env, user.id, artifactId, body);
      return addCORS(result.error ? errorJson(result.error) : json({ watch: result.watch }, 201));
    }
  }

  const idMatch = path.match(/^\/v1\/metric-watch\/([^/]+)$/);
  if (idMatch && request.method === 'DELETE') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    const result = await deleteWatch(env, user.id, idMatch[1]);
    return addCORS(result.error ? errorJson(result.error) : json({ success: true }));
  }

  return null;
}
