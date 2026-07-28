// Who may publish "open" (public) artifacts.
//
// There is no paid tier in this build, so open visibility is not a billing
// question — it is an instance policy question. allowOpen is granted when EITHER:
//   - the artifact lives in a public showcase workspace (bypasses the kill switch), OR
//   - the instance has not disabled open visibility at all, OR
//   - the publisher is in the instance's public rollout (PUBLIC_ROLLOUT_*).
// When false, coerceVisibility downgrades public to private.

import type { Env } from '../types';
import { isPublicShowcaseWorkspace } from '../workspaces';
import { openVisibilityDisabled, isUserInPublicRollout } from '../visibility-config';

export const OPEN_VISIBILITY_PAYWALL_MESSAGE =
  'Public links are turned off on this instance (OPEN_VISIBILITY_DISABLED).';

export async function resolveAllowOpen(
  env: Env,
  userId: string,
  workspaceId: string | null,
): Promise<boolean> {
  if (await isPublicShowcaseWorkspace(env, workspaceId)) return true;
  if (!openVisibilityDisabled(env)) return true;
  return isUserInPublicRollout(env, userId);
}
