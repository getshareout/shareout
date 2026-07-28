import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleCreateFolder,
  handleDeleteFolder,
  handleGetFolder,
  handleGetFolderByPath,
  handleListFolders,
  handleMoveArtifactToFolder,
  handleUpdateFolder,
  resolveFolderPath,
} from '../../src/folders';
import type { AuthUser } from '../../src/api-auth';
import type { Env, WorkspaceRole } from '../../src/types';

const user: AuthUser = { id: 'usr_1', email: 'owner@example.com', username: null };
const workspaceId = 'wsp_abc123';
const folderId = 'fld_docs123';
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
  } as unknown as Env['DB'];
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

const folderRow = {
  id: folderId,
  name: 'Docs',
  slug: 'docs',
  description: 'Documentation',
  visibility: 'public' as const,
  parent_id: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: null,
  workspace_id: workspaceId,
  workspace_slug: 'my-workspace',
  artifact_count: 0,
  subfolder_count: 0,
};

function folderDetailFirst(sql: string, ...args: unknown[]): unknown {
  if (sql.includes('FROM folders f') && sql.includes('JOIN workspaces')) {
    return folderRow;
  }
  if (sql.includes('SELECT slug, parent_id FROM folders WHERE id = ?')) {
    return { slug: 'docs', parent_id: null };
  }
  if (sql.includes('SELECT visibility, parent_id FROM folders WHERE id = ?')) {
    return { visibility: 'public', parent_id: null };
  }
  if (sql.includes('SELECT id FROM folders WHERE id = ? AND workspace_id = ?')) {
    return { id: folderId };
  }
  if (sql.includes('SELECT parent_id FROM folders WHERE id = ?')) {
    return { parent_id: null };
  }
  return null;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleListFolders', () => {
  it('returns 403 when user is not a workspace member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const response = await handleListFolders(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders`),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(403);
    expect((await jsonBody(response)).code).toBe('FORBIDDEN');
  });

  it('returns root folders for workspace member', async () => {
    const folders = [{ id: folderId, name: 'Docs', slug: 'docs', description: null, visibility: 'inherit', parent_id: null, artifact_count: 0, subfolder_count: 0, created_at: '2024-01-01' }];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('member'),
        all: (sql) => {
          if (sql.includes('parent_id IS NULL')) return { results: folders };
          return { results: [] };
        },
      }),
    };
    const response = await handleListFolders(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders`),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).folders).toEqual(folders);
  });

  it('filters by parent_id when provided', async () => {
    const parentId = 'fld_parent';
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('member'),
        all: (sql, ...args) => {
          if (sql.includes('f.parent_id = ?')) {
            expect(args).toContain(parentId);
            return { results: [] };
          }
          return { results: [] };
        },
      }),
    };
    const response = await handleListFolders(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders?parent_id=${parentId}`),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
  });
});

describe('handleCreateFolder', () => {
  it('returns 403 when user is not a workspace member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const response = await handleCreateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Docs' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(403);
  });

  it('returns 403 when member (non-admin) tries to create', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const response = await handleCreateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Docs' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(403);
    expect((await jsonBody(response)).code).toBe('ADMIN_REQUIRED');
  });

  it('returns 400 for invalid JSON', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const response = await handleCreateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders`, {
        method: 'POST',
        body: 'bad',
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('INVALID_JSON');
  });

  it('returns 400 when name is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const response = await handleCreateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '  ' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid slug', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const response = await handleCreateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Docs', slug: 'Bad Slug!' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('INVALID_SLUG');
  });

  it('returns 404 when parent folder not found', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => {
          if (sql.includes('SELECT id FROM folders WHERE id = ? AND workspace_id = ?')) return null;
          return null;
        }),
      }),
    };
    const response = await handleCreateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Nested', parent_id: 'fld_missing' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(404);
    expect((await jsonBody(response)).code).toBe('PARENT_NOT_FOUND');
  });

  it('returns 409 when slug already exists at level', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => {
          if (sql.includes('SELECT id FROM folders WHERE workspace_id = ? AND slug = ?')) {
            return { id: 'fld_existing' };
          }
          return null;
        }),
      }),
    };
    const response = await handleCreateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Docs', slug: 'docs' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(409);
    expect((await jsonBody(response)).code).toBe('SLUG_TAKEN');
  });

  it('creates folder and returns details', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'admin' };
          return folderDetailFirst(sql, ...args);
        },
        run,
      }),
    };
    const response = await handleCreateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hello World' }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.path).toBe('docs');
    expect(body.effective_visibility).toBe('public');
    expect(run).toHaveBeenCalled();
    const insertCall = (env.DB.prepare as ReturnType<typeof vi.fn>).mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO folders'),
    );
    expect(insertCall).toBeDefined();
  });
});

describe('handleGetFolder', () => {
  it('returns 403 when not a member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const response = await handleGetFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`),
      env,
      user,
      workspaceId,
      folderId,
    );
    expect(response.status).toBe(403);
  });

  it('returns 404 when folder not found', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('member', () => null),
      }),
    };
    const response = await handleGetFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/fld_missing`),
      env,
      user,
      workspaceId,
      'fld_missing',
    );
    expect(response.status).toBe(404);
    expect((await jsonBody(response)).code).toBe('NOT_FOUND');
  });

  it('returns folder with path and effective visibility', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'member' };
          return folderDetailFirst(sql, ...args);
        },
      }),
    };
    const response = await handleGetFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`),
      env,
      user,
      workspaceId,
      folderId,
    );
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.slug).toBe('docs');
    expect(body.path).toBe('docs');
    expect(body.effective_visibility).toBe('public');
  });

  it('inherits visibility from parent chain', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'member' };
          if (sql.includes('FROM folders f') && sql.includes('JOIN workspaces')) {
            return { ...folderRow, visibility: 'inherit' };
          }
          if (sql.includes('SELECT slug, parent_id FROM folders WHERE id = ?')) {
            if (args[0] === folderId) return { slug: 'child', parent_id: 'fld_parent' };
            if (args[0] === 'fld_parent') return { slug: 'parent', parent_id: null };
            return null;
          }
          if (sql.includes('SELECT visibility, parent_id FROM folders WHERE id = ?')) {
            if (args[0] === folderId) return { visibility: 'inherit', parent_id: 'fld_parent' };
            if (args[0] === 'fld_parent') return { visibility: 'private', parent_id: null };
            return null;
          }
          return null;
        },
      }),
    };
    const response = await handleGetFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`),
      env,
      user,
      workspaceId,
      folderId,
    );
    const body = await jsonBody(response);
    expect(body.effective_visibility).toBe('private');
    expect(body.path).toBe('parent/child');
  });
});

describe('handleGetFolderByPath', () => {
  it('returns 403 when not a member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const response = await handleGetFolderByPath(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/path/docs`),
      env,
      user,
      workspaceId,
      'docs',
    );
    expect(response.status).toBe(403);
  });

  it('returns 404 when path does not resolve', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('member', () => null),
      }),
    };
    const response = await handleGetFolderByPath(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/path/missing`),
      env,
      user,
      workspaceId,
      'missing',
    );
    expect(response.status).toBe(404);
  });

  it('returns folder when path resolves', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'member' };
          if (sql.includes('SELECT id FROM folders WHERE workspace_id = ? AND slug = ?')) {
            if (args[1] === 'docs') return { id: folderId };
            return null;
          }
          return folderDetailFirst(sql, ...args);
        },
      }),
    };
    const response = await handleGetFolderByPath(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/path/docs`),
      env,
      user,
      workspaceId,
      'docs',
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).slug).toBe('docs');
  });
});

describe('handleUpdateFolder', () => {
  it('returns 403 when not a member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const response = await handleUpdateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New' }),
      }),
      env,
      user,
      workspaceId,
      folderId,
    );
    expect(response.status).toBe(403);
  });

  it('returns 404 when folder not found', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('member', (sql) => {
          if (sql.includes('SELECT id FROM folders WHERE id = ? AND workspace_id = ?')) return null;
          return null;
        }),
      }),
    };
    const response = await handleUpdateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/fld_missing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New' }),
      }),
      env,
      user,
      workspaceId,
      'fld_missing',
    );
    expect(response.status).toBe(404);
  });

  it('returns 400 for invalid visibility', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'member' };
          if (sql.includes('SELECT id FROM folders WHERE id = ? AND workspace_id = ?')) return { id: folderId };
          return null;
        },
      }),
    };
    const response = await handleUpdateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'secret' }),
      }),
      env,
      user,
      workspaceId,
      folderId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('INVALID_VISIBILITY');
  });

  it('returns 409 when slug is taken on update', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'member' };
          if (sql.includes('SELECT id FROM folders WHERE id = ? AND workspace_id = ?') && !sql.includes('slug = ?')) {
            return { id: folderId };
          }
          if (sql.includes('SELECT parent_id FROM folders WHERE id = ?')) return { parent_id: null };
          if (sql.includes('slug = ? AND id != ?')) return { id: 'fld_other' };
          return null;
        },
      }),
    };
    const response = await handleUpdateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'taken' }),
      }),
      env,
      user,
      workspaceId,
      folderId,
    );
    expect(response.status).toBe(409);
    expect((await jsonBody(response)).code).toBe('SLUG_TAKEN');
  });

  it('returns 400 when no fields to update', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'member' };
          if (sql.includes('SELECT id FROM folders WHERE id = ? AND workspace_id = ?')) return { id: folderId };
          return null;
        },
      }),
    };
    const response = await handleUpdateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
      user,
      workspaceId,
      folderId,
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).code).toBe('NO_UPDATES');
  });

  it('updates folder and returns refreshed details', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'member' };
          return folderDetailFirst(sql, ...args);
        },
        run: () => ({ success: true }),
      }),
    };
    const response = await handleUpdateFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated', visibility: 'unlisted' }),
      }),
      env,
      user,
      workspaceId,
      folderId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).slug).toBe('docs');
  });
});

describe('handleDeleteFolder', () => {
  it('returns 403 for member role', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const response = await handleDeleteFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`, { method: 'DELETE' }),
      env,
      user,
      workspaceId,
      folderId,
    );
    expect(response.status).toBe(403);
  });

  it('returns 403 when not a member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const response = await handleDeleteFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`, { method: 'DELETE' }),
      env,
      user,
      workspaceId,
      folderId,
    );
    expect(response.status).toBe(403);
  });

  it('returns 404 when folder not found', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'admin' };
          if (sql.includes('SELECT id FROM folders WHERE id = ? AND workspace_id = ?')) return null;
          return null;
        },
      }),
    };
    const response = await handleDeleteFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/fld_missing`, { method: 'DELETE' }),
      env,
      user,
      workspaceId,
      'fld_missing',
    );
    expect(response.status).toBe(404);
  });

  it('orphans artifacts and promotes subfolders when deleting a non-empty folder', async () => {
    const runSql: string[] = [];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'admin' };
          if (sql.includes('SELECT id FROM folders WHERE id = ? AND workspace_id = ?')) return { id: folderId };
          return null;
        },
        run: (sql) => { runSql.push(sql); return { success: true }; },
      }),
    };
    const response = await handleDeleteFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`, { method: 'DELETE' }),
      env,
      user,
      workspaceId,
      folderId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).deleted).toBe(folderId);
    expect(runSql.some((s) => s.includes('UPDATE artifacts SET folder_id = NULL WHERE folder_id'))).toBe(true);
    expect(runSql.some((s) => s.includes('UPDATE folders SET parent_id = NULL WHERE parent_id'))).toBe(true);
    expect(runSql.some((s) => s.includes('DELETE FROM folders WHERE id'))).toBe(true);
  });

  it('deletes empty folder as admin', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'admin' };
          if (sql.includes('SELECT id FROM folders WHERE id = ? AND workspace_id = ?')) return { id: folderId };
          if (sql.includes('FROM artifacts WHERE folder_id')) return { count: 0 };
          if (sql.includes('FROM folders WHERE parent_id')) return { count: 0 };
          return null;
        },
        run,
      }),
    };
    const response = await handleDeleteFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/folders/${folderId}`, { method: 'DELETE' }),
      env,
      user,
      workspaceId,
      folderId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).deleted).toBe(folderId);
    expect(run).toHaveBeenCalled();
  });
});

describe('handleMoveArtifactToFolder', () => {
  it('returns 403 when not a member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const response = await handleMoveArtifactToFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/artifacts/art_1/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: folderId }),
      }),
      env,
      user,
      workspaceId,
      'art_1',
    );
    expect(response.status).toBe(403);
  });

  it('returns 404 when artifact not in workspace', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('member', (sql) => {
          if (sql.includes('FROM artifacts WHERE id = ? AND workspace_id = ?')) return null;
          return null;
        }),
      }),
    };
    const response = await handleMoveArtifactToFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/artifacts/art_missing/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: null }),
      }),
      env,
      user,
      workspaceId,
      'art_missing',
    );
    expect(response.status).toBe(404);
  });

  it('returns 404 when target folder not found', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('member', (sql) => {
          if (sql.includes('FROM artifacts WHERE id = ? AND workspace_id = ?')) return { id: 'art_1' };
          if (sql.includes('SELECT id FROM folders WHERE id = ? AND workspace_id = ?')) return null;
          return null;
        }),
      }),
    };
    const response = await handleMoveArtifactToFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/artifacts/art_1/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: 'fld_missing' }),
      }),
      env,
      user,
      workspaceId,
      'art_1',
    );
    expect(response.status).toBe(404);
    expect((await jsonBody(response)).code).toBe('FOLDER_NOT_FOUND');
  });

  it('moves artifact to folder', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('member', (sql) => {
          if (sql.includes('FROM artifacts WHERE id = ? AND workspace_id = ?')) return { id: 'art_1' };
          if (sql.includes('SELECT id FROM folders WHERE id = ? AND workspace_id = ?')) return { id: folderId };
          return null;
        }),
        run,
      }),
    };
    const response = await handleMoveArtifactToFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/artifacts/art_1/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: folderId }),
      }),
      env,
      user,
      workspaceId,
      'art_1',
    );
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.success).toBe(true);
    expect(body.folder_id).toBe(folderId);
    expect(run).toHaveBeenCalled();
  });

  it('moves artifact to workspace root with null folder_id', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('member', (sql) => {
          if (sql.includes('FROM artifacts WHERE id = ? AND workspace_id = ?')) return { id: 'art_1' };
          return null;
        }),
        run: () => ({ success: true }),
      }),
    };
    const response = await handleMoveArtifactToFolder(
      new Request(`https://shareout.example.com/v1/workspaces/${workspaceId}/artifacts/art_1/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: null }),
      }),
      env,
      user,
      workspaceId,
      'art_1',
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).folder_id).toBeNull();
  });
});

describe('resolveFolderPath', () => {
  it('returns null for empty path', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };
    await expect(resolveFolderPath(env, workspaceId, '')).resolves.toBeNull();
    await expect(resolveFolderPath(env, workspaceId, '/')).resolves.toBeNull();
  });

  it('returns null when segment is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    await expect(resolveFolderPath(env, workspaceId, 'missing')).resolves.toBeNull();
  });

  it('resolves nested folder path', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (args[1] === 'parent') return { id: 'fld_parent' };
          if (args[1] === 'child') return { id: 'fld_child' };
          return null;
        },
      }),
    };
    await expect(resolveFolderPath(env, workspaceId, 'parent/child')).resolves.toBe('fld_child');
  });
});
