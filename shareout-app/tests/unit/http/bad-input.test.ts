// @vitest-environment node
// Malformed input is a 400 VALIDATION_ERROR naming the param, never a 500.
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';
import type { DataContext } from '../../../src/data/middleware';
import * as middleware from '../../../src/data/middleware';
import { handleListArtifacts } from '../../../src/artifacts';
import { handleListWorkspaces, handleCreateWorkspace } from '../../../src/workspaces/crud';
import { handleCreatePersonalFolder } from '../../../src/personal-folders';
import { handleBlobs } from '../../../src/data/blobs/handler';
import { handleInbox } from '../../../src/data/inbox/handler';

const user = { id: 'usr_1', email: 'u@example.com', username: null } as AuthUser;
const env = {
  DB: { prepare: () => { throw new Error('DB must not be reached'); } },
} as unknown as Env;

function req(path: string, method = 'GET', body?: unknown) {
  return new Request(`https://shareout.site${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
}

async function expect400(res: Response, param: string) {
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR', param });
}

const ctx = {
  artifactId: 'art_1',
  workspaceId: '',
  artifact: { id: 'art_1', name: 'A', visibility: 'private', auth_method: null, workspace_id: null, owner_id: 'usr_1' },
  env,
  origin: null,
} as unknown as DataContext;

describe('non-numeric pagination params', () => {
  it('GET /v1/artifacts?limit=abc', async () => {
    await expect400(await handleListArtifacts(req('/v1/artifacts?limit=abc'), env, user), 'limit');
  });
  it('GET /v1/artifacts?offset=x', async () => {
    await expect400(await handleListArtifacts(req('/v1/artifacts?offset=x'), env, user), 'offset');
  });
  it('GET /v1/workspaces?limit=abc', async () => {
    await expect400(await handleListWorkspaces(req('/v1/workspaces?limit=abc'), env, user), 'limit');
  });
  it('GET /v1/data/{id}/blobs?limit=abc', async () => {
    await expect400(await handleBlobs(req('/v1/data/art_1/blobs?limit=abc'), ctx, ''), 'limit');
  });
});

describe('wrongly typed bodies', () => {
  it('POST /v1/workspaces {"name":123}', async () => {
    await expect400(await handleCreateWorkspace(req('/v1/workspaces', 'POST', { name: 123 }), env, user), 'name');
  });
  it('POST /v1/workspaces null', async () => {
    await expect400(await handleCreateWorkspace(req('/v1/workspaces', 'POST', null), env, user), 'name');
  });
  it('POST /v1/folders {"name":5}', async () => {
    await expect400(await handleCreatePersonalFolder(req('/v1/folders', 'POST', { name: 5 }), env, user), 'name');
  });
  it('PUT inbox/allowlist with a non-array allowlist', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    await expect400(await handleInbox(req('/x', 'PUT', { allowlist: 'bad' }), ctx, '/allowlist'), 'allowlist');
  });
  it('POST inbox/enable with a non-array allowlist', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    await expect400(await handleInbox(req('/x', 'POST', { allowlist: 'bad' }), ctx, '/enable'), 'allowlist');
  });
});
