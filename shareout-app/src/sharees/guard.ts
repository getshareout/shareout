// External-sharing spine (work/030) — management guard.
// Every Sharee/member/grant MUTATION requires workspace admin. There is no paid
// entitlement: this build has no billing, so the feature is on for every workspace.
import type { Env } from '../types';
import { requireWorkspaceRole } from '../workspaces';

/** Returns a 403 Response if the user is not a workspace admin, else null. */
export async function requireExternalSharing(
  env: Env,
  workspaceId: string,
  userId: string,
): Promise<Response | null> {
  return requireWorkspaceRole(env, workspaceId, userId, 'admin');
}
