// @vitest-environment node
// Workspace Files: a plain member may delete only files they uploaded; owners/admins
// may delete any. The list tells the client which tiles get a Delete button.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', () => ({ validateToken, hasScope: () => true }));
vi.mock('../../../src/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionUser,
}));
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
vi.mock('../../../src/workspaces/roles', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getInternalWorkspaceRole,
}));
const bucket = { id: 'art_bucket', owner_id: 'usr_admin', workspace_id: 'wsp_1' };
vi.mock('../../../src/assets/bucket', () => ({
  getOrCreateAssetBucket: vi.fn(async () => bucket),
  buildAssetBucketContext: vi.fn(() => ({})),
}));
const handleBlobs = vi.hoisted(() => vi.fn(async () => Response.json({ success: true })));
vi.mock('../../../src/data/blobs/handler', () => ({ handleBlobs, handleBlobUpload: vi.fn() }));
const listDeliverables = vi.hoisted(() => vi.fn());
vi.mock('../../../src/assets/deliverables', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listDeliverables,
}));

import { routeAssetApi } from '../../../src/router/api/assets';
import { createFetchContext } from '../../../src/router/context';

const runs: string[] = [];
const env = {
  DB: {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => (sql.includes('owner_id FROM asset_deliverables') ? { owner_id: 'usr_admin' } : null),
        all: async () => ({ results: [] }),
        run: async () => { runs.push(sql); return { success: true }; },
      }),
    }),
  },
} as unknown as Env;

function call(path: string, method = 'GET') {
  const req = new Request(`https://shareout.site${path}`, { method, headers: { Cookie: 'shareout_session=x' } });
  return routeAssetApi(createFetchContext(req, env));
}

beforeEach(() => {
  runs.length = 0;
  validateToken.mockResolvedValue(null);
  getSessionUser.mockResolvedValue({ id: 'usr_m', email: 'm@x.com' });
  getInternalWorkspaceRole.mockResolvedValue('member');
  listDeliverables.mockResolvedValue([
    { id: 'dlv_admin', ownerId: 'usr_admin', visibility: 'workspace' },
    { id: 'dlv_mine', ownerId: 'usr_m', visibility: 'workspace' },
  ]);
});

describe('workspace Files delete permission', () => {
  it('a member cannot delete a file someone else uploaded', async () => {
    const res = await call('/v1/workspaces/wsp_1/assets/deliverables/dlv_admin', 'DELETE');
    expect(res?.status).toBe(403);
    expect(runs.some((s) => s.includes('DELETE FROM asset_deliverables'))).toBe(false);
  });

  it('a member cannot delete a loose workspace blob', async () => {
    const res = await call('/v1/workspaces/wsp_1/assets/blb_1', 'DELETE');
    expect(res?.status).toBe(403);
    expect(handleBlobs).not.toHaveBeenCalled();
  });

  it('an admin can delete any workspace file', async () => {
    getInternalWorkspaceRole.mockResolvedValue('admin');
    const res = await call('/v1/workspaces/wsp_1/assets/deliverables/dlv_admin', 'DELETE');
    expect(res?.status).toBe(200);
    expect(runs.some((s) => s.includes('DELETE FROM asset_deliverables'))).toBe(true);
  });

  it('the list marks only deletable files', async () => {
    const res = await call('/v1/workspaces/wsp_1/assets');
    const j = (await res!.json()) as { deliverables: Array<{ id: string; canDelete: boolean }> };
    expect(j.deliverables.map((d) => [d.id, d.canDelete])).toEqual([['dlv_admin', false], ['dlv_mine', true]]);
  });
});
