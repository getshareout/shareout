import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWorkspaceContextDoc,
  getSkillWorkspaceContext,
  handleListWorkspaceContext,
  handleGetWorkspaceContextFile,
  handlePutWorkspaceContextFile,
  handleDeleteWorkspaceContextFile,
  handleSetWorkspaceContextEntry,
} from '../../src/workspace-context';
import type { AuthUser } from '../../src/api-auth';
import type { Env, WorkspaceRole } from '../../src/types';

const admin: AuthUser = { id: 'usr_admin', email: 'admin@acme.example', username: null };
const workspaceId = 'wsp_gal';
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
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true, meta: { changes: 0 } }),
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

const sampleFiles = [
  { name: 'index.md', content: 'Read style.md for visuals, voice.md for tone.', updated_by: 'usr_admin', updated_at: '2026-06-14T00:00:00Z' },
  { name: 'style.md', content: 'Use Acme pine #1E3D35. Never purple gradients.', updated_by: 'usr_admin', updated_at: '2026-06-14T00:00:00Z' },
  { name: 'voice.md', content: 'Say "locations", not "stores".', updated_by: 'usr_admin', updated_at: '2026-06-14T00:00:00Z' },
];

// Default entry-point lookup: SELECT context_entry FROM workspaces -> null = index.md
function entryRow(entry: string | null = null) {
  return (sql: string) => (sql.includes('context_entry FROM workspaces') ? { context_entry: entry } : null);
}

function putRequest(body: unknown, json = true): Request {
  return new Request('https://shareout.site/v1/workspaces/wsp_gal/context/style.md', {
    method: 'PUT',
    headers: json ? { 'Content-Type': 'application/json' } : {},
    body: json ? JSON.stringify(body) : String(body),
  });
}

afterEach(() => vi.restoreAllMocks());

describe('buildWorkspaceContextDoc', () => {
  it('returns empty string when there are no files', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ all: () => ({ results: [] }), first: entryRow() }) };
    expect(await buildWorkspaceContextDoc(env, workspaceId, 'Acme')).toBe('');
  });

  it('inlines only the entry file and lists the rest as a manifest', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ all: () => ({ results: sampleFiles }), first: entryRow() }) };
    const doc = await buildWorkspaceContextDoc(env, workspaceId, 'Acme');
    expect(doc).toContain('# Acme — workspace context');
    // entry (index.md) is inlined...
    expect(doc).toContain('## index.md (entry point)');
    expect(doc).toContain('Read style.md for visuals');
    // ...the others are only listed, not inlined
    expect(doc).toContain('## Other available context files');
    expect(doc).toContain('- `style.md`');
    expect(doc).toContain('- `voice.md`');
    expect(doc).not.toContain('Never purple gradients');
    // fetch hint includes the workspace-scoped path
    expect(doc).toContain(`/v1/workspaces/${workspaceId}/context/{name}`);
  });

  it('honors a custom entry filename', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ all: () => ({ results: sampleFiles }), first: entryRow('style.md') }) };
    const doc = await buildWorkspaceContextDoc(env, workspaceId, 'Acme');
    expect(doc).toContain('## style.md (entry point)');
    expect(doc).toContain('Never purple gradients');
    expect(doc).toContain('- `index.md`');
  });

  it('falls back to a manifest-only note when no entry file exists', async () => {
    const noEntry = sampleFiles.filter((f) => f.name !== 'index.md');
    const env = { ...baseEnv, DB: makeDbMock({ all: () => ({ results: noEntry }), first: entryRow() }) };
    const doc = await buildWorkspaceContextDoc(env, workspaceId, 'Acme');
    expect(doc).toContain('No `index.md` entry file is set');
    expect(doc).toContain('- `style.md`');
  });
});

describe('handleListWorkspaceContext', () => {
  it('returns 403 for non-members', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const res = await handleListWorkspaceContext(env, admin, workspaceId);
    expect(res.status).toBe(403);
  });

  it('lists file metadata + entry for a member (no content)', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: roleFirst('member', entryRow()), all: () => ({ results: sampleFiles }) }),
    };
    const res = await handleListWorkspaceContext(env, admin, workspaceId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry).toBe('index.md');
    expect(body.files).toHaveLength(3);
    expect(body.files[0]).toEqual({
      name: 'index.md',
      size: sampleFiles[0].content.length,
      is_entry: true,
      updated_by: 'usr_admin',
      updated_at: '2026-06-14T00:00:00Z',
    });
    expect(body.files[1].is_entry).toBe(false);
    expect(body.files[0].content).toBeUndefined();
  });
});

describe('handleSetWorkspaceContextEntry', () => {
  function entryRequest(body: unknown): Request {
    return new Request('https://shareout.site/v1/workspaces/wsp_gal/context', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns 403 for members (admin required)', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const res = await handleSetWorkspaceContextEntry(entryRequest({ entry: 'index.md' }), env, admin, workspaceId);
    expect(res.status).toBe(403);
  });

  it('sets a valid entry filename', async () => {
    const run = vi.fn(() => ({ success: true }));
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin'), run }) };
    const res = await handleSetWorkspaceContextEntry(entryRequest({ entry: 'house-rules.md' }), env, admin, workspaceId);
    expect(res.status).toBe(200);
    expect((await res.json()).entry).toBe('house-rules.md');
    const call = run.mock.calls.find((c) => String(c[0]).includes('UPDATE workspaces SET context_entry'));
    expect(call?.[1]).toBe('house-rules.md');
  });

  it('resets to the default when given null', async () => {
    const run = vi.fn(() => ({ success: true }));
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin'), run }) };
    const res = await handleSetWorkspaceContextEntry(entryRequest({ entry: null }), env, admin, workspaceId);
    expect(res.status).toBe(200);
    expect((await res.json()).entry).toBe('index.md');
    const call = run.mock.calls.find((c) => String(c[0]).includes('UPDATE workspaces SET context_entry'));
    expect(call?.[1]).toBeNull();
  });

  it('rejects an invalid entry name', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const res = await handleSetWorkspaceContextEntry(entryRequest({ entry: 'notmarkdown.txt' }), env, admin, workspaceId);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_NAME');
  });
});

describe('handleGetWorkspaceContextFile', () => {
  it('returns raw markdown for a member', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: roleFirst('member', (sql) => (sql.includes('SELECT content') ? { content: '# hi' } : null)) }),
    };
    const res = await handleGetWorkspaceContextFile(env, admin, workspaceId, 'style.md');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    expect(await res.text()).toBe('# hi');
  });

  it('rejects an invalid file name', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const res = await handleGetWorkspaceContextFile(env, admin, workspaceId, '../secrets');
    expect(res.status).toBe(400);
  });

  it('returns 404 when the file does not exist', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const res = await handleGetWorkspaceContextFile(env, admin, workspaceId, 'missing.md');
    expect(res.status).toBe(404);
  });
});

describe('handlePutWorkspaceContextFile', () => {
  it('returns 403 for members (admin required)', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const res = await handlePutWorkspaceContextFile(putRequest({ content: 'x' }), env, admin, workspaceId, 'style.md');
    expect(res.status).toBe(403);
  });

  it('rejects an invalid name', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const res = await handlePutWorkspaceContextFile(putRequest({ content: 'x' }), env, admin, workspaceId, 'Style.TXT');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_NAME');
  });

  it('rejects empty content', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const res = await handlePutWorkspaceContextFile(putRequest({ content: '' }), env, admin, workspaceId, 'style.md');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('EMPTY_CONTENT');
  });

  it('inserts a new file when under the limit', async () => {
    const run = vi.fn(() => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => {
          if (sql.includes("SELECT 1 AS x FROM workspace_files")) return null; // not existing
          if (sql.includes('COUNT(*)')) return { n: 2 };
          return null;
        }),
        run,
      }),
    };
    const res = await handlePutWorkspaceContextFile(putRequest({ content: '# Style' }), env, admin, workspaceId, 'style.md');
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ name: 'style.md', updated: true });
    expect(run.mock.calls.some((c) => String(c[0]).includes('INSERT INTO workspace_files'))).toBe(true);
  });

  it('rejects a new file when the per-workspace limit is reached', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => {
          if (sql.includes("SELECT 1 AS x FROM workspace_files")) return null;
          if (sql.includes('COUNT(*)')) return { n: 100 };
          return null;
        }),
      }),
    };
    const res = await handlePutWorkspaceContextFile(putRequest({ content: '# Style' }), env, admin, workspaceId, 'style.md');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('LIMIT_REACHED');
  });

  it('accepts a raw markdown body (non-JSON)', async () => {
    const run = vi.fn(() => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => (sql.includes("SELECT 1 AS x FROM workspace_files") ? { x: 1 } : null)),
        run,
      }),
    };
    const res = await handlePutWorkspaceContextFile(putRequest('# Raw markdown', false), env, admin, workspaceId, 'style.md');
    expect(res.status).toBe(200);
    expect(run.mock.calls.some((c) => String(c[0]).includes('ON CONFLICT(workspace_id, namespace, scope_id, path)'))).toBe(true);
  });
});

describe('handleDeleteWorkspaceContextFile', () => {
  it('returns 403 for members', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const res = await handleDeleteWorkspaceContextFile(env, admin, workspaceId, 'style.md');
    expect(res.status).toBe(403);
  });

  it('returns 404 when nothing was deleted', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: roleFirst('admin'), run: () => ({ meta: { changes: 0 } }) }),
    };
    const res = await handleDeleteWorkspaceContextFile(env, admin, workspaceId, 'style.md');
    expect(res.status).toBe(404);
  });

  it('deletes an existing file', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: roleFirst('admin'), run: () => ({ meta: { changes: 1 } }) }),
    };
    const res = await handleDeleteWorkspaceContextFile(env, admin, workspaceId, 'style.md');
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ name: 'style.md', deleted: true });
  });
});

describe('getSkillWorkspaceContext', () => {
  it('returns empty for an unknown workspace', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    expect(await getSkillWorkspaceContext(env, 'acme', admin.id)).toBe('');
  });

  it('returns empty for a non-member even if the workspace exists', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM workspaces')) return { id: workspaceId, name: 'Acme' };
          if (sql.includes('FROM workspace_members')) return null; // not a member
          return null;
        },
      }),
    };
    expect(await getSkillWorkspaceContext(env, 'acme', admin.id)).toBe('');
  });

  it('returns the context doc for a member', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('id, name FROM workspaces')) return { id: workspaceId, name: 'Acme' };
          if (sql.includes('FROM workspace_members')) return { 1: 1 };
          if (sql.includes('context_entry FROM workspaces')) return { context_entry: null };
          return null;
        },
        all: () => ({ results: sampleFiles }),
      }),
    };
    const doc = await getSkillWorkspaceContext(env, 'acme', admin.id);
    expect(doc).toContain('# Acme — workspace context');
    expect(doc).toContain('## index.md (entry point)');
  });
});
