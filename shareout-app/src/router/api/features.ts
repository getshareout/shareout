import type { FetchContext } from '../context';
import { createApiRouter } from '../helpers/api-router';
import { jsonError } from '../helpers/json-response';
import type { AuthUser } from '../../api-auth';
import { getUserRole } from '../../artifacts/roles';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { buildFeaturesPayload } from '../../features/flags';
import { hostWorkspaceId } from '../../pages/home/host';

/**
 * Agent-facing feature introspection. Lets the skill/agent discover what is
 * enabled before attempting to use a module, and lets it recover from a
 * FEATURE_DISABLED rejection by re-checking what IS available.
 *
 * GET /v1/features            -> the host's workspace on a workspace subdomain (if a member), else personal scope
 * GET /v1/features?workspace_id=...  -> that workspace (caller must be a member)
 * GET /v1/features?artifact_id=...   -> the artifact's workspace (caller must have access)
 */
const routeFeatures = createApiRouter([
  {
    method: 'GET',
    path: '/v1/features',
    auth: 'tokenOrSession',
    handler: async (ctx, _params, user) => {
      const authUser = user as AuthUser;
      const { env, url } = ctx;

      let workspaceId: string | null = null;

      const artifactId = url.searchParams.get('artifact_id');
      if (artifactId) {
        const role = await getUserRole(env, artifactId, authUser.id);
        if (!role) {
          return jsonError('No access to this artifact', 'FORBIDDEN', 403);
        }
        const art = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
          .bind(artifactId).first<{ workspace_id: string | null }>();
        workspaceId = art?.workspace_id ?? null;
      } else {
        const wid = url.searchParams.get('workspace_id');
        if (wid) {
          const role = await getInternalWorkspaceRole(env, wid, authUser.id);
          if (!role) {
            return jsonError('Not a member of this workspace', 'FORBIDDEN', 403);
          }
          workspaceId = wid;
        } else {
          const hostWs = await hostWorkspaceId(ctx.request, env);
          if (hostWs && await getInternalWorkspaceRole(env, hostWs, authUser.id)) workspaceId = hostWs;
        }
      }

      return Response.json(await buildFeaturesPayload(env, workspaceId));
    },
  },
]);

export async function routeFeaturesApi(ctx: FetchContext): Promise<Response | null> {
  return routeFeatures(ctx);
}
