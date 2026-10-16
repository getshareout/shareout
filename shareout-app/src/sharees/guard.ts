// External-sharing spine (work/030) — management guards.
// Two separate questions, asked in this order:
//   1. Role: may this person manage external sharing here? (admin, or a folder manager
//      for that one folder — the callers decide which role rule applies.)
//   2. Entitlement: is external sharing turned on for this workspace?
// Every path that CREATES external access must ask both. Revoking and listing ask only
// the role question, so a workspace can always wind access down.
import type { Env } from '../types';
import { requireWorkspaceRole } from '../workspaces/roles';
import { isFeatureEnabled } from '../features/flags';
import { apiErrorResponse } from '../http/api-error';

export const EXTERNAL_SHARING_FEATURE = 'collab.external_sharing';

/** The single entitlement hook for creating external access (no role check). Returns a
 *  403 Response when the workspace may not share outside, else null. Builds with plans
 *  or billing patch this one function; every create path (admin or folder manager)
 *  runs it. */
export async function requireExternalSharingEnabled(env: Env, workspaceId: string): Promise<Response | null> {
  if (await isFeatureEnabled(env, EXTERNAL_SHARING_FEATURE, workspaceId)) return null;
  return apiErrorResponse({
    message: 'External sharing is turned off for this workspace.',
    code: 'EXTERNAL_SHARING_NOT_ENTITLED',
    status: 403,
    hint: 'An instance admin can turn External sharing back on under Features.',
  });
}

/** Admin role plus the entitlement: the gate for creating Clients, members, grants
 *  and tokens. Returns a 403 Response, or null when the action may go ahead. */
export async function requireExternalSharing(
  env: Env,
  workspaceId: string,
  userId: string,
): Promise<Response | null> {
  return (await requireWorkspaceRole(env, workspaceId, userId, 'admin'))
    ?? requireExternalSharingEnabled(env, workspaceId);
}
