/**
 * GET /v1/artifacts/{id}/sources — the page's data sources (see src/provenance/).
 * Open to anyone who can view the page, the same way the page itself is: the handler
 * runs the viewer's own gate and answers 404 to everyone else. Workspace Agent tokens
 * are not a credential here (default guards), so they see only what the public sees.
 */
import type { FetchContext } from '../context';
import { handleGetArtifactSources } from '../../provenance/handler';

export async function routeArtifactSourcesApi(ctx: FetchContext): Promise<Response | null> {
  const { request, path, addCORS } = ctx;
  const match = path.match(/^\/v1\/artifacts\/([^/]+)\/sources$/);
  if (!match || request.method !== 'GET') return null;
  return addCORS(await handleGetArtifactSources(ctx, match[1]));
}
