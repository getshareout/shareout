/**
 * Resolves workspace context from the request hostname (subdomain routing).
 */
import type { Env } from '../../types';
import { parseSubdomainFromEnv } from '../../subdomain';
import { requestMemo, timePhase } from '../../http/request-scope';
import { workspaceIdBySlug } from '../../workspaces/host-cache';

export async function hostWorkspaceId(request: Request, env: Env): Promise<string | null> {
  const { isSubdomain, workspaceSlug } = parseSubdomainFromEnv(new URL(request.url).hostname, env);
  if (!isSubdomain || !workspaceSlug) return null;
  return requestMemo(env, `host:${workspaceSlug}`, () => timePhase(env, 'host', () => workspaceIdBySlug(env, workspaceSlug)));
}
