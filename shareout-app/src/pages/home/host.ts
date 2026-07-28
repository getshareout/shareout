/**
 * Resolves workspace context from the request hostname (subdomain routing).
 */
import type { Env } from '../../types';
import { parseSubdomainFromEnv } from '../../subdomain';

export async function hostWorkspaceId(request: Request, env: Env): Promise<string | null> {
  const { isSubdomain, workspaceSlug } = parseSubdomainFromEnv(new URL(request.url).hostname, env);
  if (!isSubdomain || !workspaceSlug) return null;
  const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?')
    .bind(workspaceSlug).first<{ id: string }>();
  return ws?.id || null;
}
