import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/router/helpers/auth-guard', async (orig) => {
  const actual = await orig<typeof import('../../src/router/helpers/auth-guard')>();
  return {
    ...actual,
    requireTokenOrSession: vi.fn(async () => ({ id: 'usr_1', email: 'admin@example.com', username: null })),
    isAuthUser: vi.fn(() => true),
  };
});
// work/030 sweep: code now calls getInternalWorkspaceRole; alias both to one mock fn.
const wsRoleMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/workspaces', async (orig) => {
  const actual = await orig<typeof import('../../src/workspaces')>();
  return { ...actual, getWorkspaceRole: wsRoleMock, getInternalWorkspaceRole: wsRoleMock };
});
vi.mock('../../src/superadmin/artifacts-admin', () => ({
  setArtifactPaused: vi.fn(async () => {}),
  setArtifactVisibility: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../src/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../src/artifacts/collaborators', () => ({ transferArtifactOwnership: vi.fn(async () => null) }));

import { routeWorkspaceApi } from '../../src/router/api/workspaces';
import { getWorkspaceRole } from '../../src/workspaces';
import { setArtifactPaused, setArtifactVisibility } from '../../src/superadmin/artifacts-admin';
import { transferArtifactOwnership } from '../../src/artifacts/collaborators';
import { logAudit } from '../../src/audit';
import { createFetchContext } from '../../src/router/context';
import type { Env } from '../../src/types';

const wsId = 'wsp_abc';
const artId = 'art_1';

function dbMock(ownsRow: unknown) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ownsRow),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ success: true })),
      })),
    })),
  } as unknown as Env['DB'];
}

// SQL-aware mock: routes each first() by matching the prepared SQL to a key.
function dbMockSql(map: { artifact?: unknown; member?: unknown }) {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (/FROM artifacts WHERE id/.test(sql)) return map.artifact ?? null;
          if (/workspace_members/.test(sql)) return map.member ?? null;
          return null;
        }),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ success: true })),
      })),
    })),
  } as unknown as Env['DB'];
}

function call(method: string, path: string, env: Env, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  return routeWorkspaceApi(createFetchContext(new Request('https://shareout.site' + path, init), env));
}

afterEach(() => vi.clearAllMocks());

describe('workspace admin artifact governance', () => {
  it('forbids a non-admin member from the governance table', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('member');
    const res = await call('GET', `/v1/workspaces/${wsId}/admin/artifacts`, { DB: dbMock(null) } as Env);
    expect(res?.status).toBe(403);
  });

  it('pauses an artifact in the workspace and writes an audit entry', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const res = await call('POST', `/v1/workspaces/${wsId}/admin/artifacts/${artId}/pause`, { DB: dbMock({ id: artId }) } as Env, { paused: true });
    expect(res?.status).toBe(200);
    expect(setArtifactPaused).toHaveBeenCalledWith(expect.anything(), artId, true);
    expect(logAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'artifact.pause', targetId: artId }));
  });

  it('refuses to mutate an artifact from another workspace (404, no write)', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const res = await call('POST', `/v1/workspaces/${wsId}/admin/artifacts/${artId}/pause`, { DB: dbMock(null) } as Env, { paused: true });
    expect(res?.status).toBe(404);
    expect(setArtifactPaused).not.toHaveBeenCalled();
  });

  it('forbids a member from changing visibility', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('member');
    const res = await call('POST', `/v1/workspaces/${wsId}/admin/artifacts/${artId}/visibility`, { DB: dbMock({ id: artId }) } as Env, { visibility: 'public' });
    expect(res?.status).toBe(403);
    expect(setArtifactVisibility).not.toHaveBeenCalled();
  });

  it('reassigns ownership to a workspace member and audits it', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const env = { DB: dbMockSql({ artifact: { id: artId, owner_id: 'usr_old' }, member: { id: 'usr_new' } }) } as Env;
    const res = await call('POST', `/v1/workspaces/${wsId}/admin/artifacts/${artId}/transfer`, env, { email: 'new@example.com' });
    expect(res?.status).toBe(200);
    expect(transferArtifactOwnership).toHaveBeenCalledWith(expect.anything(), artId, 'usr_old', 'new@example.com', 'usr_1');
    expect(logAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'artifact.transfer' }));
  });

  it('refuses reassigning to someone who is not a workspace member', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const env = { DB: dbMockSql({ artifact: { id: artId, owner_id: 'usr_old' }, member: null }) } as Env;
    const res = await call('POST', `/v1/workspaces/${wsId}/admin/artifacts/${artId}/transfer`, env, { email: 'stranger@example.com' });
    expect(res?.status).toBe(400);
    expect(transferArtifactOwnership).not.toHaveBeenCalled();
  });

  it('rejects an invalid reassign email', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const env = { DB: dbMockSql({ artifact: { id: artId, owner_id: 'usr_old' } }) } as Env;
    const res = await call('POST', `/v1/workspaces/${wsId}/admin/artifacts/${artId}/transfer`, env, { email: 'nope' });
    expect(res?.status).toBe(400);
    expect(transferArtifactOwnership).not.toHaveBeenCalled();
  });
});
