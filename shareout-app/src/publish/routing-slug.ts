/**
 * Globally-unique routing slug allocation for new artifacts.
 *
 * The human slug (display_slug) may repeat across workspaces; the routing key
 * (artifacts.slug) drives canonical /a/<slug> URLs and must stay unique platform-wide.
 */
import type { Env } from '../types';
import { shortHash } from '../validation';

export async function allocateRoutingSlug(
  env: Env,
  baseSlug: string,
  workspaceId: string | null,
  ownerId: string,
): Promise<string> {
  const isTaken = async (candidate: string): Promise<boolean> =>
    !!(await env.DB.prepare('SELECT 1 FROM artifacts WHERE slug = ? LIMIT 1').bind(candidate).first());

  if (!(await isTaken(baseSlug))) return baseSlug;

  const scopeHash = shortHash(workspaceId ?? ownerId);
  let candidate = `${baseSlug}-${scopeHash}`;
  for (let n = 2; await isTaken(candidate); n++) {
    candidate = `${baseSlug}-${scopeHash}-${n}`;
  }
  return candidate;
}
