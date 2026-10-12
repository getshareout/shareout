// @vitest-environment node
// POST /v1/folders with a workspace_id follows the Team Space rules instead of
// silently creating a Personal folder.
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';
import type { AuthUser } from '../../src/api-auth';

const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
vi.mock('../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));

import { handleCreatePersonalFolder } from '../../src/personal-folders';

const user = { id: 'usr_1', email: 'u@example.com', username: null } as AuthUser;
const env = { DB: { prepare: () => { throw new Error('DB must not be reached'); } } } as unknown as Env;

function post(body: unknown) {
  return new Request('https://shareout.site/v1/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/folders with workspace_id', () => {
  it('403s for a workspace the caller is not a member of', async () => {
    getInternalWorkspaceRole.mockResolvedValue(null);
    const res = await handleCreatePersonalFolder(post({ name: 'X', workspace_id: 'wsp_000000000000000000000000' }), env, user);
    expect(res.status).toBe(403);
    expect(getInternalWorkspaceRole).toHaveBeenCalledWith(env, 'wsp_000000000000000000000000', 'usr_1');
  });

  it('applies the Team Space admin rule for plain members', async () => {
    getInternalWorkspaceRole.mockResolvedValue('member');
    const res = await handleCreatePersonalFolder(post({ name: 'X', workspace_id: 'wsp_1' }), env, user);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ADMIN_REQUIRED' });
  });
});
