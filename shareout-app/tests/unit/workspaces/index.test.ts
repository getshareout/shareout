import { describe, expect, it } from 'vitest';
import * as workspaces from '../../../src/workspaces';

/** Guardrail: public API surface stays stable after module decomposition. */
describe('workspaces module exports', () => {
  const expected = [
    'getWorkspaceRole',
    'invalidateWorkspaceRole',
    'requireWorkspaceRole',
    'isPublicShowcaseWorkspace',
    'getWorkspaceAccessPolicy',
    'isEmailAllowedByPolicy',
    'normalizeDomain',
    'parseJsonList',
    'autoJoinWorkspacesByDomain',
    'handleGetWorkspaceAccessPolicy',
    'handleUpdateWorkspaceAccessPolicy',
    'inviteOrAddMember',
    'MAX_BULK_INVITES',
    'handleListWorkspaceMembers',
    'handleAddWorkspaceMember',
    'handleInviteWorkspaceMembers',
    'handleListWorkspaceMemberMetrics',
    'handleListWorkspacePeople',
    'handleRemoveWorkspaceMember',
    'handleTransferWorkspaceOwnership',
    'handleListWorkspaces',
    'handleCreateWorkspace',
    'handleUpdateWorkspace',
    'handleDeleteWorkspace',
    'handleGetWorkspace',
    'handleGetWorkspaceBySlug',
    'parseBranding',
    'handleGetWorkspaceBranding',
    'handleUpdateWorkspaceBranding',
    'handleUploadWorkspaceLogo',
    'handleDeleteWorkspaceLogo',
    'generateWorkspaceSlug',
    'SLUG_REGEX',
  ] as const;

  it.each(expected)('exports %s', (name) => {
    expect(workspaces).toHaveProperty(name);
    expect(typeof (workspaces as Record<string, unknown>)[name]).not.toBe('undefined');
  });
});
