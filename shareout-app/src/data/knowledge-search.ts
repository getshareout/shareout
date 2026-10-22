import { DATA_ERRORS } from '../types';
import { successResponse, errorResponse, resolveRequesterUserId, type DataContext } from './middleware';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { isKnowledgeEnabled } from '../knowledge/store';
import { corpusFor } from '../knowledge/corpus/client';
import { searchCorpus } from '../knowledge/corpus/search';

// Runtime Knowledge search for a published artifact:
//   GET /v1/data/{artifactId}/knowledge/search?q=&limit=
// The page's session token can't call /v1/workspaces/{ws}/knowledge/search (not an API
// token), so this tier re-authorizes the viewer here. Only an authenticated INTERNAL
// member of the artifact's own workspace gets results; searchCorpus then re-checks each
// hit's visibility for that user, exactly as the REST route does.
export async function handleKnowledge(request: Request, ctx: DataContext, path: string): Promise<Response> {
  if (path.replace(/\/$/, '') !== '/search') return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
  if (request.method !== 'GET') return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Use GET.' }, ctx.origin);
  if (!ctx.workspaceId) {
    return errorResponse({ ...DATA_ERRORS.FORBIDDEN, message: 'Knowledge search requires the artifact to belong to a workspace.' }, ctx.origin);
  }

  const userId = await resolveRequesterUserId(request, ctx);
  if (!userId) return errorResponse({ ...DATA_ERRORS.UNAUTHORIZED, message: 'Sign in to search workspace Knowledge.' }, ctx.origin);
  if (!(await getInternalWorkspaceRole(ctx.env, ctx.workspaceId, userId))) {
    return errorResponse({ ...DATA_ERRORS.FORBIDDEN, message: 'Knowledge search is available to workspace members only.' }, ctx.origin);
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'q is required.' }, ctx.origin);
  if (!(await isKnowledgeEnabled(ctx.env, ctx.workspaceId)) || !corpusFor(ctx.env, ctx.workspaceId)) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: 'Knowledge is not enabled for this workspace.' }, ctx.origin);
  }

  const result = await searchCorpus(ctx.env, ctx.workspaceId, userId, q, {
    limit: Number(url.searchParams.get('limit')) || undefined,
    ctx: ctx.waitUntil ? { waitUntil: ctx.waitUntil } : undefined,
  });
  return successResponse({ query: q, ...result }, 200, ctx.origin);
}
