import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getWorkspaceRole,
  invalidateWorkspaceRole,
  handleAddWorkspaceMember,
  handleCreateWorkspace,
  handleDeleteWorkspace,
  handleGetWorkspace,
  handleGetWorkspaceBySlug,
  handleListWorkspaceMembers,
  handleListWorkspaces,
  handleRemoveWorkspaceMember,
  handleTransferWorkspaceOwnership,
  handleUpdateWorkspace,
} from '../../src/workspaces';
import type { AuthUser } from '../../src/api-auth';
import type { Env, WorkspaceRole } from '../../src/types';

const user: AuthUser = { id: 'usr_1', email: 'owner@example.com', username: null };
const workspaceId = 'wsp_abc123';
const baseEnv = {} as Env;

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
        all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true }),
      })),
    })),
    batch: vi.fn(async () => []),
  } as unknown as Env['DB'];
}

function makeKvMock(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const kv = {
    store,
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
  return kv;
}

function roleFirst(role: WorkspaceRole | null, extra?: (sql: string, ...args: unknown[]) => unknown) {
  return (sql: string, ...args: unknown[]) => {
    if (sql.includes('SELECT role FROM workspace_members')) {
      return role ? { role } : null;
    }
    return extra?.(sql, ...args) ?? null;
  };
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

const workspaceRow = {
  id: workspaceId,
  name: 'My Workspace',
  slug: 'my-workspace',
  description: 'A workspace',
  owner_id: 'usr_1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: null,
  role: 'owner' as WorkspaceRole,
  artifact_count: 0,
  folder_count: 2,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getWorkspaceRole', () => {
  it('returns role when user is a member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => ({ role: 'admin' }) }) };
    await expect(getWorkspaceRole(env, workspaceId, user.id)).resolves.toBe('admin');
  });

  it('returns null when user is not a member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    await expect(getWorkspaceRole(env, workspaceId, user.id)).resolves.toBeNull();
  });

  it('caches the role in SLUGS and skips D1 on the second call', async () => {
    const dbFirst = vi.fn(() => ({ role: 'admin' as WorkspaceRole }));
    const SLUGS = makeKvMock();
    const env = { ...baseEnv, SLUGS, DB: makeDbMock({ first: dbFirst }) } as unknown as Env;
    await expect(getWorkspaceRole(env, workspaceId, user.id)).resolves.toBe('admin');
    await expect(getWorkspaceRole(env, workspaceId, user.id)).resolves.toBe('admin');
    expect(dbFirst).toHaveBeenCalledTimes(1);
    expect(SLUGS.put).toHaveBeenCalledWith(`wsrole:${workspaceId}:${user.id}`, 'admin', { expirationTtl: 300 });
  });

  it('caches a non-member as "none" and serves null from cache', async () => {
    const dbFirst = vi.fn(() => null);
    const SLUGS = makeKvMock();
    const env = { ...baseEnv, SLUGS, DB: makeDbMock({ first: dbFirst }) } as unknown as Env;
    await expect(getWorkspaceRole(env, workspaceId, user.id)).resolves.toBeNull();
    await expect(getWorkspaceRole(env, workspaceId, user.id)).resolves.toBeNull();
    expect(dbFirst).toHaveBeenCalledTimes(1);
    expect(SLUGS.store.get(`wsrole:${workspaceId}:${user.id}`)).toBe('none');
  });

  it('invalidateWorkspaceRole drops the key so the next read re-queries D1', async () => {
    const dbFirst = vi.fn(() => ({ role: 'member' as WorkspaceRole }));
    const SLUGS = makeKvMock();
    const env = { ...baseEnv, SLUGS, DB: makeDbMock({ first: dbFirst }) } as unknown as Env;
    await getWorkspaceRole(env, workspaceId, user.id);
    await invalidateWorkspaceRole(env, workspaceId, user.id);
    await getWorkspaceRole(env, workspaceId, user.id);
    expect(SLUGS.delete).toHaveBeenCalledWith(`wsrole:${workspaceId}:${user.id}`);
    expect(dbFirst).toHaveBeenCalledTimes(2);
  });

  it('falls back to D1 when SLUGS.get throws (fail-open)', async () => {
    const dbFirst = vi.fn(() => ({ role: 'owner' as WorkspaceRole }));
    const SLUGS = makeKvMock();
    SLUGS.get = vi.fn(async () => { throw new Error('kv down'); });
    const env = { ...baseEnv, SLUGS, DB: makeDbMock({ first: dbFirst }) } as unknown as Env;
    await expect(getWorkspaceRole(env, workspaceId, user.id)).resolves.toBe('owner');
    expect(dbFirst).toHaveBeenCalledTimes(1);
  });
});

describe('handleListWorkspaces', () => {
  it('returns paginated workspace list', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        all: (sql) => {
          if (sql.includes('FROM workspaces w')) {
            return { results: [workspaceRow] };
          }
          return { results: [] };
        },
        first: (sql) => {
          if (sql.includes('COUNT(DISTINCT workspace_id) as total')) return { total: 1 };
          return null;
        },
      }),
    };

    const response = await handleListWorkspaces(
      new Request('https://shareout.example.com/v1/workspaces?limit=10&offset=0'),
      env,
      user,
    );

    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.total).toBe(1);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    expect(body.workspaces).toHaveLength(1);
  });

  it('caps limit at 100', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        all: () => ({ results: [] }),
        first: () => ({ total: 0 }),
      }),
    };

    const response = await handleListWorkspaces(
      new Request('https://shareout.example.com/v1/workspaces?limit=500'),
      env,
      user,
    );

    const body = await jsonBody(response);
    expect(body.limit).toBe(100);
  });
});

describe('handleCreateWorkspace', () => {
  it('returns 400 for invalid JSON', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };
    const response = await handleCreateWorkspace(
      new Request('https://shareout.example.com/v1/workspaces', {
        method: 'POST',
        body: 'not-json',
      }),
      env,
      user,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('INVALID_JSON');
  });

  it('returns 400 when name is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };
    const response = await handleCreateWorkspace(
      new Request('https://shareout.example.com/v1/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      }),
      env,
      user,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid slug format', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };
    const response = await handleCreateWorkspace(
      new Request('https://shareout.example.com/v1/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', slug: 'Invalid Slug!' }),
      }),
      env,
      user,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('INVALID_SLUG');
  });

  it('returns 409 when slug is taken', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM workspaces WHERE slug')) return { id: 'wsp_other' };
          return null;
        },
      }),
    };
    const response = await handleCreateWorkspace(
      new Request('https://shareout.example.com/v1/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', slug: 'taken-slug' }),
      }),
      env,
      user,
    );
    expect(response.status).toBe(409);
    expect((await jsonBody(response)).code).toBe('SLUG_TAKEN');
  });

  it('creates workspace with auto-generated slug', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => null,
        run,
      }),
    };
    const response = await handleCreateWorkspace(
      new Request('https://shareout.example.com/v1/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hello World', description: 'Desc' }),
      }),
      env,
      user,
    );

    expect(response.status).toBe(201);
    const body = await jsonBody(response);
    expect(body.name).toBe('Hello World');
    expect(body.slug).toBe('hello-world');
    expect(body.role).toBe('owner');
    expect(body.description).toBe('Desc');
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('handleGetWorkspace', () => {
  it('returns 404 when workspace not found', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    const response = await handleGetWorkspace(
      new Request('https://shareout.example.com/v1/workspaces/wsp_missing'),
      env,
      user,
      'wsp_missing',
    );
    expect(response.status).toBe(404);
    expect((await jsonBody(response)).code).toBe('NOT_FOUND');
  });

  it('returns workspace details for member', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => workspaceRow }),
    };
    const response = await handleGetWorkspace(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}`),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.slug).toBe('my-workspace');
    expect(body.role).toBe('owner');
  });
});

describe('handleGetWorkspaceBySlug', () => {
  it('returns 404 when slug not found', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    const response = await handleGetWorkspaceBySlug(
      new Request('https://shareout.example.com/v1/workspaces/by-slug/missing'),
      env,
      user,
      'missing',
    );
    expect(response.status).toBe(404);
  });

  it('returns workspace by slug', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => workspaceRow }) };
    const response = await handleGetWorkspaceBySlug(
      new Request('https://shareout.example.com/v1/workspaces/by-slug/my-workspace'),
      env,
      user,
      'my-workspace',
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).slug).toBe('my-workspace');
  });
});

describe('handleUpdateWorkspace', () => {
  it('returns 403 for member role', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: roleFirst('member') }),
    };
    const response = await handleUpdateWorkspace(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(403);
  });

  it('returns 403 when not a member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const response = await handleUpdateWorkspace(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid JSON', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const response = await handleUpdateWorkspace(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}`, {
        method: 'PATCH',
        body: '{bad',
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('INVALID_JSON');
  });

  it('returns 400 for invalid slug', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const response = await handleUpdateWorkspace(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'Bad Slug' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('INVALID_SLUG');
  });

  it('returns 409 when slug is taken', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => {
          if (sql.includes('FROM workspaces WHERE slug')) return { id: 'wsp_other' };
          return null;
        }),
      }),
    };
    const response = await handleUpdateWorkspace(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'taken-slug' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(409);
    expect((await jsonBody(response)).code).toBe('SLUG_TAKEN');
  });

  it('returns 400 when no fields to update', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const response = await handleUpdateWorkspace(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('NO_UPDATES');
  });

  it('updates workspace and returns refreshed details', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'admin' };
          if (sql.includes('FROM workspaces w')) return { ...workspaceRow, name: 'Updated' };
          return null;
        },
        run: () => ({ success: true }),
      }),
    };
    const response = await handleUpdateWorkspace(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated', description: null }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).name).toBe('Updated');
  });
});

describe('handleDeleteWorkspace', () => {
  it('returns 403 for admin role', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const response = await handleDeleteWorkspace(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}`, { method: 'DELETE' }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(403);
  });

  it('returns 400 when workspace has artifacts', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'owner' };
          if (sql.includes('COUNT(*) as count FROM artifacts')) return { count: 3 };
          return null;
        },
      }),
    };
    const response = await handleDeleteWorkspace(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}`, { method: 'DELETE' }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('WORKSPACE_NOT_EMPTY');
  });

  it('deletes empty workspace as owner', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'owner' };
          if (sql.includes('COUNT(*) as count FROM artifacts')) return { count: 0 };
          return null;
        },
        run,
      }),
    };
    const response = await handleDeleteWorkspace(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}`, { method: 'DELETE' }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).deleted).toBe(workspaceId);
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe('handleListWorkspaceMembers', () => {
  it('returns 403 when not a member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const response = await handleListWorkspaceMembers(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/members`),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(403);
  });

  it('returns member list for workspace member', async () => {
    const members = [{ id: 'wsm_1', role: 'owner', created_at: '2024-01-01', user_id: 'usr_1', email: 'owner@example.com', name: 'Owner', is_service: 0 }];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('member'),
        all: () => ({ results: members }),
      }),
    };
    const response = await handleListWorkspaceMembers(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/members`),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    // Handler annotates each member with is_agent (true for is_service principals).
    expect((await jsonBody(response)).members).toEqual(members.map((m) => ({ ...m, is_agent: false })));
  });
});

describe('handleAddWorkspaceMember', () => {
  it('returns 403 for member role', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const response = await handleAddWorkspaceMember(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(403);
  });

  it('returns 400 when email is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const response = await handleAddWorkspaceMember(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid role', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const response = await handleAddWorkspaceMember(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', role: 'owner' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('INVALID_ROLE');
  });

  it('creates and invites the user when the email is not yet registered', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => {
          if (sql.includes('FROM users WHERE email')) return null; // user does not exist yet
          return null;
        }),
        all: () => ({ results: [] }),
        run,
      }),
    };
    const response = await handleAddWorkspaceMember(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'missing@example.com' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    // user row + member row + invite-claim row all inserted
    expect(run).toHaveBeenCalled();
  });

  it('inserts new member and returns member list', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')) {
            return { role: 'admin' };
          }
          if (sql.includes('FROM users WHERE email')) return { id: 'usr_2' };
          if (sql.includes('FROM workspace_members WHERE workspace_id = ? AND user_id = ?') && args[1] === 'usr_2') {
            return null;
          }
          return null;
        },
        all: () => ({ results: [{ id: 'wsm_2', role: 'member', user_id: 'usr_2' }] }),
        run: () => ({ success: true }),
      }),
    };
    const response = await handleAddWorkspaceMember(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'New@Example.com', role: 'member' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).members).toHaveLength(1);
  });

  it('updates role for existing member', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?') && args[1] === user.id) {
            return { role: 'admin' };
          }
          if (sql.includes('FROM users WHERE email')) return { id: 'usr_2' };
          if (sql.includes('FROM workspace_members WHERE workspace_id = ? AND user_id = ?') && args[1] === 'usr_2') {
            return { id: 'wsm_2' };
          }
          return null;
        },
        all: () => ({ results: [] }),
        run,
      }),
    };
    const response = await handleAddWorkspaceMember(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'existing@example.com', role: 'admin' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalled();
  });
});

describe('handleRemoveWorkspaceMember', () => {
  it('returns 400 when removing owner', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members') && args[1] === user.id) {
            return { role: 'admin' };
          }
          if (sql.includes('SELECT role FROM workspace_members') && args[1] === 'usr_owner') {
            return { role: 'owner' };
          }
          return null;
        },
        all: () => ({ results: [] }),
      }),
    };
    const response = await handleRemoveWorkspaceMember(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/members/usr_owner`, { method: 'DELETE' }),
      env,
      user,
      workspaceId,
      'usr_owner',
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('CANNOT_REMOVE_OWNER');
  });

  it('removes member and returns updated list', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members') && args[1] === user.id) {
            return { role: 'admin' };
          }
          if (sql.includes('SELECT role FROM workspace_members') && args[1] === 'usr_2') {
            return { role: 'member' };
          }
          return null;
        },
        all: () => ({ results: [] }),
        run: () => ({ success: true }),
      }),
    };
    const response = await handleRemoveWorkspaceMember(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/members/usr_2`, { method: 'DELETE' }),
      env,
      user,
      workspaceId,
      'usr_2',
    );
    expect(response.status).toBe(200);
  });

  it('invalidates the removed member\'s cached role', async () => {
    const SLUGS = makeKvMock({ [`wsrole:${workspaceId}:usr_2`]: 'member' });
    const env = {
      ...baseEnv,
      SLUGS,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members') && args[1] === user.id) {
            return { role: 'admin' };
          }
          if (sql.includes('SELECT role FROM workspace_members') && args[1] === 'usr_2') {
            return { role: 'member' };
          }
          return null;
        },
        all: () => ({ results: [] }),
        run: () => ({ success: true }),
      }),
    } as unknown as Env;
    await handleRemoveWorkspaceMember(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/members/usr_2`, { method: 'DELETE' }),
      env,
      user,
      workspaceId,
      'usr_2',
    );
    expect(SLUGS.delete).toHaveBeenCalledWith(`wsrole:${workspaceId}:usr_2`);
  });
});

describe('handleTransferWorkspaceOwnership', () => {
  it('returns 403 for non-owner', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const response = await handleTransferWorkspaceOwnership(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'usr_2' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(403);
  });

  it('returns 400 when user_id is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('owner') }) };
    const response = await handleTransferWorkspaceOwnership(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when target is not a member', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members') && args[1] === user.id) {
            return { role: 'owner' };
          }
          if (sql.includes('SELECT id FROM workspace_members')) return null;
          return null;
        },
      }),
    };
    const response = await handleTransferWorkspaceOwnership(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'usr_2' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('NOT_MEMBER');
  });

  it('transfers ownership successfully', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members') && args[1] === user.id) {
            return { role: 'owner' };
          }
          if (sql.includes('SELECT id FROM workspace_members')) return { id: 'wsm_2' };
          return null;
        },
        run,
      }),
    };
    const batch = env.DB.batch as ReturnType<typeof vi.fn>;
    const response = await handleTransferWorkspaceOwnership(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'usr_2' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).new_owner).toBe('usr_2');
    // 3 ownership writes in ONE batch (demote actor, promote target, update workspace
    // owner) — a partial transfer would leave two owners or none. The audit insert
    // stays a separate run().
    expect(batch).toHaveBeenCalledTimes(1);
    expect((batch.mock.calls[0][0] as unknown[])).toHaveLength(3);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

