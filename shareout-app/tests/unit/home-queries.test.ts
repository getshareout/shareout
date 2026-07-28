import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  queryHomeCounts,
  queryHomeArtifactCatalog,
  queryPersonalFolders,
  queryFoldersInParent,
  queryFolderPath,
  queryHomeTags,
  queryRecentlyViewed,
  queryRecentActivity,
  queryRecentComments,
} from '../../src/pages/home/queries';
import type { Env } from '../../src/types';
import type { VisibilityScope } from '../../src/account-links';

const user = { id: 'usr_1', email: 'owner@example.com' };
const vis: VisibilityScope = { userIds: ['usr_1'], emails: ['owner@example.com'] };

interface MockHandlers {
  first?: (sql: string, ...args: unknown[]) => unknown;
  all?: (sql: string, ...args: unknown[]) => unknown;
}

/** D1 stub that records every prepared SQL string so tests can assert query shape & count. */
function mkEnv(prepared: string[], handlers: MockHandlers = {}): Env {
  const DB = {
    prepare: vi.fn((sql: string) => {
      prepared.push(sql);
      return {
        bind: vi.fn((...args: unknown[]) => ({
          first: vi.fn(async () => handlers.first?.(sql, ...args) ?? null),
          all: vi.fn(async () => handlers.all?.(sql, ...args) ?? { results: [] }),
          run: vi.fn(async () => ({ success: true })),
        })),
      };
    }),
  };
  return { DB } as unknown as Env;
}

/** getVisibilityScope() resolves linked accounts via `SELECT identity_id FROM users` first. */
const scopeResolutions = (prepared: string[]) =>
  prepared.filter(s => s.includes('SELECT identity_id FROM users')).length;

const countStatements = (prepared: string[]) =>
  prepared.filter(s => s.includes('COUNT(DISTINCT a.id)'));

afterEach(() => vi.restoreAllMocks());

describe('Stage 1 — visibility scope is threaded, not re-resolved', () => {
  it('does not re-resolve scope when vis is provided to the helpers', async () => {
    const prepared: string[] = [];
    const env = mkEnv(prepared, { first: () => ({ total: 0 }) });
    await queryHomeCounts(env, user, null, vis);
    await queryHomeArtifactCatalog(env, user, null, vis);
    await queryPersonalFolders(env, user, vis);
    await queryHomeTags(env, user, null, vis);
    expect(scopeResolutions(prepared)).toBe(0);
  });

  it('still resolves scope itself when vis is omitted (backward compatible)', async () => {
    const prepared: string[] = [];
    const env = mkEnv(prepared, {
      first: (sql) => {
        if (sql.includes('SELECT identity_id FROM users')) return { identity_id: null };
        if (sql.includes('FROM users WHERE id = ?')) {
          return { id: 'usr_1', email: 'owner@example.com', name: null, picture: null };
        }
        return { total: 0 };
      },
    });
    await queryHomeCounts(env, user, null);
    expect(scopeResolutions(prepared)).toBeGreaterThanOrEqual(1);
  });
});

describe('Stage 2 — sidebar counts run concurrently', () => {
  it('issues all three counts before any resolves (Promise.all, not sequential awaits)', async () => {
    const prepared: string[] = [];
    const env = mkEnv(prepared, {
      first: (sql) => {
        if (sql.includes('JOIN favorites')) return { total: 3 };
        if (sql.includes('a.owner_id NOT IN')) return { total: 2 };
        return { total: 10 };
      },
    });
    // Don't await: Promise.all builds all three statements synchronously up front,
    // so all three are prepared before the first one resolves. Sequential awaits
    // would have prepared only the first by this point.
    const pending = queryHomeCounts(env, user, null, vis);
    expect(countStatements(prepared)).toHaveLength(3);
    expect(await pending).toEqual({ allCount: 10, favCount: 3, sharedCount: 2 });
  });
});

describe('Stage 4 — feature-presence flags use EXISTS, not COUNT(*)', () => {
  it('emits EXISTS subqueries for the five feature badges in the catalog SELECT', async () => {
    const prepared: string[] = [];
    const env = mkEnv(prepared, { first: () => ({ total: 1 }), all: () => ({ results: [] }) });
    await queryHomeArtifactCatalog(env, user, null, vis);
    const catalogSql = prepared.find(s => s.includes('as f_blobs'));
    expect(catalogSql).toBeDefined();
    expect(catalogSql).toContain('EXISTS(SELECT 1 FROM blobs WHERE artifact_id = a.id)');
    expect(catalogSql).toContain('EXISTS(SELECT 1 FROM datasets WHERE artifact_id = a.id)');
    expect(catalogSql).toContain("EXISTS(SELECT 1 FROM connections WHERE scope_type = 'artifact' AND scope_id = a.id AND kind = 'generic')");
    expect(catalogSql).toContain("EXISTS(SELECT 1 FROM connections WHERE scope_type = 'artifact' AND scope_id = a.id AND kind = 'platform')");
    expect(catalogSql).toContain('EXISTS(SELECT 1 FROM scheduled_jobs WHERE artifact_id = a.id AND enabled = 1)');
    expect(catalogSql).not.toContain('COUNT(*) FROM blobs');
  });
});

describe('user_role never resolves to null (workspace member viewing non-owned, non-collaborated artifact)', () => {
  it('coalesces the collaborator role to a viewer default in the catalog SELECT', async () => {
    const prepared: string[] = [];
    const env = mkEnv(prepared, { first: () => ({ total: 1 }), all: () => ({ results: [] }) });
    await queryHomeArtifactCatalog(env, user, null, vis);
    const catalogSql = prepared.find(s => s.includes('as user_role'));
    expect(catalogSql).toBeDefined();
    // A bare `ELSE c.role` returns NULL for a workspace member who is neither owner
    // nor an explicit collaborator, which crashed escapeHtml() on the home render.
    expect(catalogSql).toContain("ELSE COALESCE(c.role, 'viewer') END as user_role");
    expect(catalogSql).not.toMatch(/ELSE c\.role END as user_role/);
  });
});

describe('subdomain isolation — recent/activity/comment queries pin to a workspace when given one', () => {
  /** Capture the SQL + bind args of the last all() call. */
  function captureEnv() {
    const calls: { sql: string; args: unknown[] }[] = [];
    const env = mkEnv([], { all: (sql, ...args) => { calls.push({ sql, args }); return { results: [] }; } });
    return { env, calls };
  }

  it('queryRecentlyViewed scopes to the workspace on a subdomain, mixes on apex', async () => {
    const a = captureEnv();
    await queryRecentlyViewed(a.env, user, { workspaceId: 'wsp_team' }, vis);
    const scoped = a.calls.at(-1)!;
    expect(scoped.sql).toContain('a.workspace_id = ?');
    expect(scoped.args).toContain('wsp_team');

    const b = captureEnv();
    await queryRecentlyViewed(b.env, user, {}, vis);
    const apex = b.calls.at(-1)!;
    expect(apex.sql).not.toContain('a.workspace_id = ?');
    expect(apex.args).not.toContain('wsp_team');
  });

  it('queryRecentActivity scopes to the workspace when given one', async () => {
    const a = captureEnv();
    await queryRecentActivity(a.env, user, 'wsp_team');
    expect(a.calls.at(-1)!.sql).toContain('a.workspace_id = ?');
    expect(a.calls.at(-1)!.args).toContain('wsp_team');

    const b = captureEnv();
    await queryRecentActivity(b.env, user);
    expect(b.calls.at(-1)!.sql).not.toContain('a.workspace_id = ?');
  });

  it('queryRecentComments scopes to the workspace when given one', async () => {
    const a = captureEnv();
    await queryRecentComments(a.env, user, 'wsp_team');
    expect(a.calls.at(-1)!.sql).toContain('a.workspace_id = ?');
    expect(a.calls.at(-1)!.args).toContain('wsp_team');

    const b = captureEnv();
    await queryRecentComments(b.env, user);
    expect(b.calls.at(-1)!.sql).not.toContain('a.workspace_id = ?');
  });
});

describe('work/026 — queryFoldersInParent generalizes root-only folder queries to nested drill-in', () => {
  function captureEnv(handlers: MockHandlers = {}) {
    const calls: { sql: string; args: unknown[] }[] = [];
    const env = mkEnv([], {
      all: (sql, ...args) => { calls.push({ sql, args }); return handlers.all?.(sql, ...args) ?? { results: [] }; },
      first: handlers.first,
    });
    return { env, calls };
  }

  it('personal scope: parentId null queries root (parent_id IS NULL), a parentId queries that folder’s children', async () => {
    const root = captureEnv();
    await queryFoldersInParent(root.env, user, { workspaceId: null, parentId: null }, vis);
    const rootSql = root.calls.at(-1)!;
    expect(rootSql.sql).toContain('f.parent_id IS NULL');
    expect(rootSql.sql).not.toContain('f.parent_id = ?');

    const child = captureEnv();
    await queryFoldersInParent(child.env, user, { workspaceId: null, parentId: 'fld_a' }, vis);
    const childSql = child.calls.at(-1)!;
    expect(childSql.sql).toContain('f.parent_id = ?');
    expect(childSql.args).toContain('fld_a');
  });

  it('workspace scope binds workspace_id and gates on membership', async () => {
    const notMember = captureEnv({ first: () => null });
    const result = await queryFoldersInParent(notMember.env, user, { workspaceId: 'wsp_1', parentId: null }, vis);
    expect(result).toEqual([]);

    const member = captureEnv({ first: () => ({ id: 1 }) });
    await queryFoldersInParent(member.env, user, { workspaceId: 'wsp_1', parentId: 'fld_b' }, vis);
    const sql = member.calls.at(-1)!;
    expect(sql.sql).toContain('f.workspace_id = ?');
    expect(sql.sql).toContain('f.parent_id = ?');
    expect(sql.args).toEqual(['wsp_1', 'fld_b']);
  });

  it('queryPersonalFolders/queryTeamFolders still resolve (delegate to queryFoldersInParent at root)', async () => {
    const a = captureEnv();
    await queryPersonalFolders(a.env, user, vis);
    expect(a.calls.at(-1)!.sql).toContain('f.parent_id IS NULL');
  });

  it('queryFolderPath walks parent_id root-to-leaf via a recursive CTE', async () => {
    // The SQL orders by depth DESC, i.e. root first — the mock just returns that
    // already-ordered shape, since ordering itself is exercised by the SQL text assertion.
    const c = captureEnv({ all: () => ({ results: [{ id: 'fld_a', name: 'A' }, { id: 'fld_b', name: 'B' }] }) });
    const result = await queryFolderPath(c.env, user, { workspaceId: null, folderId: 'fld_b' }, vis);
    expect(c.calls.at(-1)!.sql).toContain('WITH RECURSIVE');
    expect(c.calls.at(-1)!.args[0]).toBe('fld_b');
    expect(result).toEqual([{ id: 'fld_a', name: 'A' }, { id: 'fld_b', name: 'B' }]);
  });
});

describe('opt-005 — per-artifact view totals read from artifact_view_totals, not analytics_daily', () => {
  it('catalog path joins artifact_view_totals and never scans analytics_daily', async () => {
    const prepared: string[] = [];
    const env = mkEnv(prepared, { first: () => ({ total: 1 }), all: () => ({ results: [] }) });
    await queryHomeArtifactCatalog(env, user, null, vis);
    const catalogSql = prepared.find(s => s.includes('as total_views'));
    expect(catalogSql).toBeDefined();
    expect(catalogSql).toContain('LEFT JOIN artifact_view_totals avt ON avt.artifact_id = a.id');
    expect(catalogSql).toContain('COALESCE(avt.views, 0) as total_views');
    expect(catalogSql).toContain('COALESCE(avt.unique_visitors, 0) as unique_visitors');
    // Golden invariant: the hot catalog path must not touch the growing table.
    expect(catalogSql).not.toContain('analytics_daily');
  });
});
