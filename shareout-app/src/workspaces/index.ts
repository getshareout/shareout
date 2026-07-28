/**
 * Workspace domain — REST handlers for `/v1/workspaces` and membership/access helpers.
 *
 * Module layout:
 * - `roles` — membership role cache, authorization, public showcase check
 * - `access-policy` — domain/email allowlists and auto-join on sign-in
 * - `invite` — single/bulk member invite flow
 * - `members` — roster, metrics, remove, ownership transfer
 * - `crud` — create, list, update, delete workspaces
 * - `read` — fetch workspace by id or slug
 * - `branding` — logo, accent color, footer visibility
 * - `slug` — slug validation and generation
 */
export {
  getWorkspaceRole,
  getInternalWorkspaceRole,
  invalidateWorkspaceRole,
  requireWorkspaceRole,
  isPublicShowcaseWorkspace,
} from './roles';
export {
  getWorkspaceAccessPolicy,
  isEmailAllowedByPolicy,
  normalizeDomain,
  parseJsonList,
  autoJoinWorkspacesByDomain,
  hasWorkspaceSignupAllowlist,
  handleGetWorkspaceAccessPolicy,
  handleUpdateWorkspaceAccessPolicy,
} from './access-policy';
export { inviteOrAddMember, MAX_BULK_INVITES } from './invite';
export {
  handleListWorkspaceMembers,
  handleAddWorkspaceMember,
  handleInviteWorkspaceMembers,
  handleListWorkspaceMemberMetrics,
  handleListWorkspacePeople,
  handleRemoveWorkspaceMember,
  handleTransferWorkspaceOwnership,
} from './members';
export {
  handleListWorkspaces,
  handleCreateWorkspace,
  handleUpdateWorkspace,
  handleDeleteWorkspace,
} from './crud';
export {
  handleGetWorkspace,
  handleGetWorkspaceBySlug,
} from './read';
export {
  parseBranding,
  handleGetWorkspaceBranding,
  handleUpdateWorkspaceBranding,
  handleUploadWorkspaceLogo,
  handleDeleteWorkspaceLogo,
} from './branding';
export type { WorkspaceBranding } from './branding';
export { generateWorkspaceSlug, SLUG_REGEX } from './slug';
