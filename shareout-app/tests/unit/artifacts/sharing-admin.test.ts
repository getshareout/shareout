// @vitest-environment node
/**
 * Workspace owners/admins govern the SHARING of artifacts in their workspace —
 * collaborators, ownership, access requests — without gaining content access.
 */
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleAddCollaborators, handleGetCollaborators } from '../../../src/artifacts';
import { decideAccessRequest } from '../../../src/artifacts/access-requests';
import { baseEnv, jsonBody, makeDbMock, user } from './shared';

vi.mock('../../../src/email/gateway', () => ({
  dispatchLifecycleEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../../../src/telegram/linking', () => ({ getLinkedChatId: vi.fn(async () => null) }));

/** The caller owns nothing on the artifact; their only claim is a workspace role. */
function envWithWorkspaceRole(role: string | null, extra?: (sql: string) => unknown) {
  return {
    ...baseEnv,
    DB: makeDbMock({
      first: (sql: string) => {
        const fromExtra = extra?.(sql);
        if (fromExtra !== undefined && fromExtra !== null) return fromExtra;
        if (sql.includes('auth_method FROM artifacts')) return { id: 'art_1', auth_method: 'none' };
        if (sql.includes('SELECT id FROM artifacts')) return { id: 'art_1' };
        if (sql.includes('SELECT workspace_id FROM artifacts')) return { workspace_id: 'wsp_1' };
        if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_someone_else' };
        if (sql.includes('email FROM users')) return { email: 'admin@example.com' };
        if (sql.includes('role FROM collaborators')) return null; // not a collaborator
        if (sql.includes('SELECT role FROM workspace_members')) return role ? { role } : null;
        return null;
      },
    }),
  };
}

function addRequest() {
  return new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators', {
    method: 'POST',
    body: JSON.stringify({ emails: ['new@example.com'], role: 'viewer' }),
  });
}

describe('workspace admin sharing authority', () => {
  it('lets a workspace admin read the collaborator list of a page they do not own', async () => {
    const res = await handleGetCollaborators(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators'),
      envWithWorkspaceRole('admin'), user, 'art_1');
    expect(res.status).toBe(200);
  });

  it('lets a workspace admin add a collaborator to a page they do not own', async () => {
    const res = await handleAddCollaborators(addRequest(), envWithWorkspaceRole('admin'), user, 'art_1');
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({ added: ['new@example.com'] });
  });

  it('still refuses a plain workspace member', async () => {
    const res = await handleAddCollaborators(addRequest(), envWithWorkspaceRole('member'), user, 'art_1');
    expect(res.status).toBe(403);
  });

  it('still refuses a non-member', async () => {
    const res = await handleAddCollaborators(addRequest(), envWithWorkspaceRole(null), user, 'art_1');
    expect(res.status).toBe(403);
  });

  it('lets a workspace admin decide an access request on a page they do not own', async () => {
    // Otherwise a request against a departed member's page sits in a queue nobody
    // can answer.
    const env = envWithWorkspaceRole('admin', (sql) => {
      if (sql.includes('FROM access_requests ar')) {
        return {
          id: 'arq_1', artifact_id: 'art_1', requester_email: 'ask@example.com',
          requester_name: 'Ask', status: 'pending', artifact_name: 'Demo',
          artifact_slug: 'demo', owner_id: 'usr_someone_else',
        };
      }
      return null;
    });
    const result = await decideAccessRequest(env, user.id, 'arq_1', 'approve');
    expect(result.ok).toBe(true);
  });

  it('refuses an access-request decision from a plain member', async () => {
    const env = envWithWorkspaceRole('member', (sql) => {
      if (sql.includes('FROM access_requests ar')) {
        return {
          id: 'arq_1', artifact_id: 'art_1', requester_email: 'ask@example.com',
          requester_name: 'Ask', status: 'pending', artifact_name: 'Demo',
          artifact_slug: 'demo', owner_id: 'usr_someone_else',
        };
      }
      return null;
    });
    const result = await decideAccessRequest(env, user.id, 'arq_1', 'approve');
    expect(result.ok).toBe(false);
  });
});
