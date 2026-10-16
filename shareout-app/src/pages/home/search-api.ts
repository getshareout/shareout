import type { Env } from '../../types';
import { hostWorkspaceId } from './host';
import { timePhase } from '../../http/request-scope';
import { jsonWithApiErrors } from '../../http/api-error';
import { buildSearchIndex, etagMatches, searchIndexEtag } from '../../search/search-index';
import { deepSearch } from '../../search/deep-search';
import { cleanQuery, listRecentSearches, recentScopeKey, recordRecentSearch, removeRecentSearch } from '../../search/recent-searches';

type User = { id: string; email: string | null };

async function workspaceParam(request: Request, env: Env): Promise<string | undefined> {
  return (await hostWorkspaceId(request, env)) || new URL(request.url).searchParams.get('workspace')?.trim() || undefined;
}

/**
 * GET /v1/home/search-index?workspace= — the compact index the palette ranks locally.
 * Revalidated with If-None-Match: an unchanged index answers 304 with no body.
 */
export async function handleHomeSearchIndexApi(request: Request, env: Env, user: User): Promise<Response> {
  const workspaceId = await workspaceParam(request, env);
  const index = await timePhase(env, 'idx_build', () => buildSearchIndex(env, user.id, workspaceId));
  const body = JSON.stringify(index);
  const etag = await timePhase(env, 'idx_etag', () => searchIndexEtag(user.id, workspaceId, body));
  const headers = {
    ETag: etag,
    'Cache-Control': 'private, no-cache',
    Vary: 'Cookie',
  };
  if (etagMatches(request.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

/** GET /v1/home/deep-search?q=&workspace=&older=1 — content matches the local index cannot see. */
export async function handleHomeDeepSearchApi(request: Request, env: Env, user: User): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() || '';
  const workspaceId = await workspaceParam(request, env);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 5, 20);
  const result = await timePhase(env, 'deep', () => deepSearch(env, user.id, { q, workspaceId, older: url.searchParams.get('older') === '1', limit }));
  return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * /v1/home/recent-searches?workspace= — GET lists, POST { q } records, DELETE ?q= removes
 * one (no q clears the scope). Always the signed-in user's own rows.
 */
export async function handleHomeRecentSearchesApi(request: Request, env: Env, user: User): Promise<Response> {
  const scope = recentScopeKey(await workspaceParam(request, env));
  if (request.method === 'GET') {
    return Response.json({ searches: await listRecentSearches(env, user.id, scope) }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (request.method === 'POST') {
    const body = ((await request.json().catch(() => null)) ?? {}) as { q?: unknown };
    const q = cleanQuery(body.q);
    if (!q) return jsonWithApiErrors({ error: 'q required', code: 'VALIDATION_ERROR', param: 'q' }, 400);
    return Response.json({ searches: await recordRecentSearch(env, user.id, scope, q) });
  }
  const q = new URL(request.url).searchParams.get('q');
  return Response.json({ searches: await removeRecentSearch(env, user.id, scope, q == null ? null : q) });
}
