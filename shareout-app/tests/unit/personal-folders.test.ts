import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleListPersonalFolders,
  handleCreatePersonalFolder,
  handleUpdatePersonalFolder,
  handleDeletePersonalFolder,
  handleMovePersonalArtifactToFolder,
} from '../../src/personal-folders';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

const user: AuthUser = { id: 'usr_1', email: 'owner@example.com', username: null };
const folderId = 'fld_personal1';
const baseEnv = {} as Env;

/** getVisibilityScope() resolves the linked-account set; with no identity it is just [user]. */
function visScopeFirst(sql: string): unknown {
  if (sql.includes('SELECT identity_id FROM users WHERE id = ?')) return { identity_id: null };
  if (sql.includes('FROM users WHERE id = ?')) {
    return { id: user.id, email: user.email, name: null, picture: null };
  }
  return null;
}

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? visScopeFirst(sql)),
        all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true }),
      })),
    })),
  } as unknown as Env['DB'];
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleListPersonalFolders', () => {
  it('returns the user\'s root personal folders', async () => {
    const folders = [{ id: folderId, name: 'Docs', slug: 'docs', description: null, created_at: '2024-01-01', artifact_count: 3 }];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        all: (sql) => (sql.includes('FROM folders f') ? { results: folders } : { results: [] }),
      }),
    };
    const response = await handleListPersonalFolders(
      new Request('https://shareout.example.com/v1/folders'),
      env,
      user,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).folders).toEqual(folders);
  });
});

describe('handleCreatePersonalFolder', () => {
  it('returns 400 for invalid JSON', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };
    const response = await handleCreatePersonalFolder(
      new Request('https://shareout.example.com/v1/folders', { method: 'POST', body: 'bad' }),
      env,
      user,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('INVALID_JSON');
  });

  it('returns 400 when name is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };
    const response = await handleCreatePersonalFolder(
      new Request('https://shareout.example.com/v1/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '  ' }),
      }),
      env,
      user,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 when a folder with that slug already exists', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id FROM folders WHERE workspace_id IS NULL')) return { id: 'fld_existing' };
          return visScopeFirst(sql);
        },
      }),
    };
    const response = await handleCreatePersonalFolder(
      new Request('https://shareout.example.com/v1/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Docs' }),
      }),
      env,
      user,
    );
    expect(response.status).toBe(409);
    expect((await jsonBody(response)).code).toBe('SLUG_TAKEN');
  });

  it('creates a personal folder owned by the user', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id FROM folders WHERE workspace_id IS NULL')) return null;
          return visScopeFirst(sql);
        },
        run,
      }),
    };
    const response = await handleCreatePersonalFolder(
      new Request('https://shareout.example.com/v1/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Hello World' }),
      }),
      env,
      user,
    );
    expect(response.status).toBe(201);
    const body = await jsonBody(response);
    expect(body.name).toBe('Hello World');
    expect(body.slug).toBe('hello-world');
    expect(body.artifact_count).toBe(0);
    const insertCall = (env.DB.prepare as ReturnType<typeof vi.fn>).mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO folders'),
    );
    expect(insertCall).toBeDefined();
  });
});

describe('handleUpdatePersonalFolder', () => {
  it('returns 404 when the folder is not owned', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM folders WHERE id = ? AND workspace_id IS NULL')) return null;
          return visScopeFirst(sql);
        },
      }),
    };
    const response = await handleUpdatePersonalFolder(
      new Request(`https://shareout.example.com/v1/folders/${folderId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New' }),
      }),
      env,
      user,
      folderId,
    );
    expect(response.status).toBe(404);
  });

  it('renames an owned folder', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM folders WHERE id = ? AND workspace_id IS NULL')) return { id: folderId };
          return visScopeFirst(sql);
        },
        run,
      }),
    };
    const response = await handleUpdatePersonalFolder(
      new Request(`https://shareout.example.com/v1/folders/${folderId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Renamed' }),
      }),
      env,
      user,
      folderId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).success).toBe(true);
    expect(run).toHaveBeenCalled();
  });
});

describe('handleDeletePersonalFolder', () => {
  it('orphans artifacts back to no folder when deleting a non-empty folder', async () => {
    const runSql: string[] = [];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM folders WHERE id = ? AND workspace_id IS NULL')) return { id: folderId };
          return visScopeFirst(sql);
        },
        run: (sql) => { runSql.push(sql); return { success: true }; },
      }),
    };
    const response = await handleDeletePersonalFolder(
      new Request(`https://shareout.example.com/v1/folders/${folderId}`, { method: 'DELETE' }),
      env,
      user,
      folderId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).deleted).toBe(folderId);
    expect(runSql.some((s) => s.includes('UPDATE artifacts SET folder_id = NULL WHERE folder_id'))).toBe(true);
    expect(runSql.some((s) => s.includes('DELETE FROM folders WHERE id'))).toBe(true);
  });

  it('deletes an empty owned folder', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM folders WHERE id = ? AND workspace_id IS NULL')) return { id: folderId };
          if (sql.includes('FROM artifacts WHERE folder_id')) return { count: 0 };
          return visScopeFirst(sql);
        },
        run,
      }),
    };
    const response = await handleDeletePersonalFolder(
      new Request(`https://shareout.example.com/v1/folders/${folderId}`, { method: 'DELETE' }),
      env,
      user,
      folderId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).deleted).toBe(folderId);
    expect(run).toHaveBeenCalled();
  });
});

describe('handleMovePersonalArtifactToFolder', () => {
  it('returns 404 when the artifact is not a personal artifact the user owns', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM artifacts WHERE id = ? AND workspace_id IS NULL')) return null;
          return visScopeFirst(sql);
        },
      }),
    };
    const response = await handleMovePersonalArtifactToFolder(
      new Request('https://shareout.example.com/v1/artifacts/art_x/folder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id: folderId }),
      }),
      env,
      user,
      'art_x',
    );
    expect(response.status).toBe(404);
  });

  it('returns 404 when the target folder is not owned', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM artifacts WHERE id = ? AND workspace_id IS NULL')) return { id: 'art_1' };
          if (sql.includes('FROM folders WHERE id = ? AND workspace_id IS NULL')) return null;
          return visScopeFirst(sql);
        },
      }),
    };
    const response = await handleMovePersonalArtifactToFolder(
      new Request('https://shareout.example.com/v1/artifacts/art_1/folder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id: 'fld_missing' }),
      }),
      env,
      user,
      'art_1',
    );
    expect(response.status).toBe(404);
    expect((await jsonBody(response)).code).toBe('FOLDER_NOT_FOUND');
  });

  it('moves an owned artifact into a folder', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM artifacts WHERE id = ? AND workspace_id IS NULL')) return { id: 'art_1' };
          if (sql.includes('FROM folders WHERE id = ? AND workspace_id IS NULL')) return { id: folderId };
          return visScopeFirst(sql);
        },
        run,
      }),
    };
    const response = await handleMovePersonalArtifactToFolder(
      new Request('https://shareout.example.com/v1/artifacts/art_1/folder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id: folderId }),
      }),
      env,
      user,
      'art_1',
    );
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.success).toBe(true);
    expect(body.folder_id).toBe(folderId);
    expect(run).toHaveBeenCalled();
  });

  it('moves an artifact back to the root with null folder_id', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM artifacts WHERE id = ? AND workspace_id IS NULL')) return { id: 'art_1' };
          return visScopeFirst(sql);
        },
        run: () => ({ success: true }),
      }),
    };
    const response = await handleMovePersonalArtifactToFolder(
      new Request('https://shareout.example.com/v1/artifacts/art_1/folder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id: null }),
      }),
      env,
      user,
      'art_1',
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).folder_id).toBeNull();
  });
});
