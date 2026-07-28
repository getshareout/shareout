// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  validateAccessPolicy,
  parseAccessPolicy,
  resolveViewerScope,
  viewerScopeSqlList,
  viewerScopeCacheKey,
  type AccessPolicy,
} from '../../../src/data/access-policy';
import { handleTables } from '../../../src/data/tables';
import { handleJsonStore } from '../../../src/data/json-store';
import type { DataContext } from '../../../src/data/middleware';

const POLICY: AccessPolicy = {
  version: 1,
  field: 'company_id',
  default: 'deny',
  rules: [
    { match: { email: 'buyer@acme.com' }, values: [1] },
    { match: { domain: 'acme.com' }, values: [1, 2] },
    { match: { domain: 'globex.com' }, values: [3] },
  ],
};

describe('resolveViewerScope', () => {
  it('returns null (no filtering) when there is no policy', () => {
    expect(resolveViewerScope(null, { email: 'x@y.com', isOwner: false })).toBeNull();
  });

  it('bypasses the policy for owners/editors', () => {
    expect(resolveViewerScope(POLICY, { email: 'buyer@acme.com', isOwner: true })).toBeNull();
  });

  it('matches an exact email rule', () => {
    expect(resolveViewerScope(POLICY, { email: 'buyer@acme.com', isOwner: false }))
      .toEqual({ field: 'company_id', values: [1, 2] }); // email rule [1] ∪ domain rule [1,2]
  });

  it('matches by domain (case-insensitive)', () => {
    expect(resolveViewerScope(POLICY, { email: 'Someone@ACME.com', isOwner: false }))
      .toEqual({ field: 'company_id', values: [1, 2] });
  });

  it('isolates a different domain to its own values', () => {
    expect(resolveViewerScope(POLICY, { email: 'a@globex.com', isOwner: false }))
      .toEqual({ field: 'company_id', values: [3] });
  });

  it('denies (empty values) when no rule matches and default is deny', () => {
    expect(resolveViewerScope(POLICY, { email: 'a@stranger.com', isOwner: false }))
      .toEqual({ field: 'company_id', values: [] });
  });

  it('denies anonymous viewers under default deny', () => {
    expect(resolveViewerScope(POLICY, { email: null, isOwner: false }))
      .toEqual({ field: 'company_id', values: [] });
  });

  it('returns null (open) when no rule matches and default is allow', () => {
    const open = { ...POLICY, default: 'allow' as const };
    expect(resolveViewerScope(open, { email: 'a@stranger.com', isOwner: false })).toBeNull();
  });
});

describe('validateAccessPolicy', () => {
  it('accepts a well-formed policy', () => {
    expect(validateAccessPolicy(POLICY)).toBeNull();
  });

  it('accepts null', () => {
    expect(validateAccessPolicy(null)).toBeNull();
  });

  it('rejects a wrong version', () => {
    expect(validateAccessPolicy({ ...POLICY, version: 2 })).toMatch(/version/);
  });

  it('rejects a missing field', () => {
    expect(validateAccessPolicy({ ...POLICY, field: '' })).toMatch(/field/);
  });

  it('rejects a bad default', () => {
    expect(validateAccessPolicy({ ...POLICY, default: 'maybe' })).toMatch(/default/);
  });

  it('rejects a rule with neither email nor domain', () => {
    expect(validateAccessPolicy({ ...POLICY, rules: [{ match: {}, values: [1] }] })).toMatch(/email.*domain/);
  });

  it('rejects empty values', () => {
    expect(validateAccessPolicy({ ...POLICY, rules: [{ match: { domain: 'a.com' }, values: [] }] })).toMatch(/values/);
  });
});

describe('parseAccessPolicy', () => {
  it('parses valid JSON', () => {
    expect(parseAccessPolicy(JSON.stringify(POLICY))).toEqual(POLICY);
  });

  it('returns null for invalid JSON', () => {
    expect(parseAccessPolicy('{not json')).toBeNull();
  });

  it('returns null for structurally invalid policy', () => {
    expect(parseAccessPolicy(JSON.stringify({ version: 9 }))).toBeNull();
  });

  it('returns null for absent column', () => {
    expect(parseAccessPolicy(null)).toBeNull();
  });
});

describe('viewerScopeSqlList', () => {
  it('renders numbers as bare SQL literals', () => {
    expect(viewerScopeSqlList({ field: 'company_id', values: [1, 2] })).toBe('1, 2');
  });

  it('quotes and escapes string values', () => {
    expect(viewerScopeSqlList({ field: 'region', values: ["EU", "O'Hare"] })).toBe("'EU', 'O''Hare'");
  });

  it('renders an empty scope as NULL (matches nothing)', () => {
    expect(viewerScopeSqlList({ field: 'company_id', values: [] })).toBe('NULL');
  });
});

describe('viewerScopeCacheKey', () => {
  it('is "all" for no scope', () => {
    expect(viewerScopeCacheKey(null)).toBe('all');
    expect(viewerScopeCacheKey(undefined)).toBe('all');
  });

  it('is stable regardless of value order', () => {
    expect(viewerScopeCacheKey({ field: 'company_id', values: [2, 1] }))
      .toBe(viewerScopeCacheKey({ field: 'company_id', values: [1, 2] }));
  });

  it('differs across scopes', () => {
    expect(viewerScopeCacheKey({ field: 'company_id', values: [1] }))
      .not.toBe(viewerScopeCacheKey({ field: 'company_id', values: [3] }));
  });
});

describe('json store gating', () => {
  const jsonCtx = (scope: DataContext['viewerScope']): DataContext => ({
    artifactId: 'art_1', workspaceId: 'ws_1',
    artifact: { id: 'art_1', name: 'A', visibility: 'private', auth_method: 'google', workspace_id: 'ws_1' },
    db: {} as DataContext['db'], env: {} as DataContext['env'], origin: null, viewerScope: scope,
  });

  it('forbids json reads for a scoped (non-owner) viewer', async () => {
    const res = await handleJsonStore(
      new Request('https://shareout.site/v1/data/art_1/json/settings', { method: 'GET' }),
      jsonCtx({ field: 'company_id', values: [1] }), '/settings'
    );
    expect(res.status).toBe(403);
  });

  it('forbids json for a deny-all viewer too', async () => {
    const res = await handleJsonStore(
      new Request('https://shareout.site/v1/data/art_1/json', { method: 'GET' }),
      jsonCtx({ field: 'company_id', values: [] }), '/'
    );
    expect(res.status).toBe(403);
  });
});

// --- Enforcement wiring: the scope clause must be AND-ed into table reads ---

interface Captured {
  sql: string;
  params: unknown[];
}

function captureDb(captured: Captured[]) {
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => {
        captured.push({ sql, params });
        return {
          first: vi.fn(async () => {
            if (sql.includes('SELECT id FROM artifact_tables')) return { id: 'tbl_1' };
            if (sql.includes('COUNT(*) as total')) return { total: 0 };
            return null;
          }),
          all: vi.fn(async () => ({ results: [] })),
          run: vi.fn(async () => ({ success: true, meta: { changes: 0 } })),
        };
      }),
    })),
    batch: async (statements: Array<{ sql: string; bindings?: unknown[]; mode?: 'first' | 'all' | 'run' }>) => {
      const out: Array<{ result?: unknown; results?: unknown[]; meta?: { changes: number } }> = [];
      for (const s of statements) {
        const stmt = db.prepare(s.sql).bind(...(s.bindings ?? []));
        if (s.mode === 'first') out.push({ result: await stmt.first() });
        else if (s.mode === 'run') out.push({ meta: (await stmt.run()).meta });
        else out.push({ results: (await stmt.all()).results });
      }
      return out;
    },
  };
  return db;
}

function ctx(scope: DataContext['viewerScope'], db: ReturnType<typeof captureDb>): DataContext {
  return {
    artifactId: 'art_1',
    workspaceId: 'ws_1',
    artifact: { id: 'art_1', name: 'A', visibility: 'private', auth_method: 'google', workspace_id: 'ws_1' },
    db: db as unknown as DataContext['db'],
    env: {} as DataContext['env'],
    origin: null,
    viewerScope: scope,
  };
}

function queryReq(filter?: Record<string, unknown>) {
  return new Request('https://shareout.site/v1/data/art_1/tables/sales/query', {
    method: 'POST',
    body: JSON.stringify(filter ? { filter } : {}),
  });
}

describe('table read enforcement', () => {
  it('injects the scope IN clause and binds its values on query', async () => {
    const captured: Captured[] = [];
    const db = captureDb(captured);
    await handleTables(queryReq(), ctx({ field: 'company_id', values: [1, 2] }, db), 'sales/query');

    const select = captured.find((c) => c.sql.includes('SELECT r.data FROM artifact_rows'));
    expect(select).toBeDefined();
    expect(select!.sql).toContain("json_extract(data, '$.company_id') IN (?, ?)");
    expect(select!.params).toEqual(['art_1', 'sales', 1, 2, 100, 0]);
  });

  it('intersects with a client filter (both clauses AND-ed)', async () => {
    const captured: Captured[] = [];
    const db = captureDb(captured);
    await handleTables(queryReq({ region: 'EU' }), ctx({ field: 'company_id', values: [3] }, db), 'sales/query');

    const select = captured.find((c) => c.sql.includes('SELECT r.data FROM artifact_rows'));
    expect(select!.sql).toContain("json_extract(data, '$.region') = ?");
    expect(select!.sql).toContain("json_extract(data, '$.company_id') IN (?)");
    expect(select!.params).toEqual(['art_1', 'sales', 'EU', 3, 100, 0]);
  });

  it('emits a deny-all (1=0) clause for an empty scope', async () => {
    const captured: Captured[] = [];
    const db = captureDb(captured);
    await handleTables(queryReq(), ctx({ field: 'company_id', values: [] }, db), 'sales/query');

    const select = captured.find((c) => c.sql.includes('SELECT r.data FROM artifact_rows'));
    expect(select!.sql).toContain('1=0');
  });

  it('applies no restriction (1=1) when the viewer has no scope (owner bypass)', async () => {
    const captured: Captured[] = [];
    const db = captureDb(captured);
    await handleTables(queryReq(), ctx(null, db), 'sales/query');

    const select = captured.find((c) => c.sql.includes('SELECT r.data FROM artifact_rows'));
    expect(select!.sql).toContain('1=1');
    expect(select!.sql).not.toContain('1=0');
  });

  it('scopes getRowById so out-of-scope rows 404', async () => {
    const captured: Captured[] = [];
    const db = captureDb(captured);
    const res = await handleTables(
      new Request('https://shareout.site/v1/data/art_1/tables/sales/row_9', { method: 'GET' }),
      ctx({ field: 'company_id', values: [3] }, db),
      'sales/row_9'
    );
    const get = captured.find((c) => c.sql.includes('SELECT r.data FROM artifact_rows') && c.sql.includes('AND r.id = ?'));
    expect(get!.sql).toContain("json_extract(data, '$.company_id') IN (?)");
    expect(get!.params).toEqual(['art_1', 'sales', 'row_9', 3]);
    expect(res.status).toBe(404); // mock returns no row → not found
  });

  it('scopes deleteRowById so out-of-scope ids cannot be deleted', async () => {
    const captured: Captured[] = [];
    const db = captureDb(captured);
    await handleTables(
      new Request('https://shareout.site/v1/data/art_1/tables/sales/row_9', { method: 'DELETE' }),
      ctx({ field: 'company_id', values: [3] }, db),
      'sales/row_9'
    );
    const del = captured.find((c) => c.sql.includes('DELETE FROM artifact_rows WHERE table_id = (SELECT id') && c.sql.includes('RETURNING id'));
    expect(del!.sql).toContain("json_extract(data, '$.company_id') IN (?)");
    expect(del!.params).toEqual(['art_1', 'sales', 'row_9', 3]);
  });

  it('scopes filter-based delete to the viewer rows only', async () => {
    const captured: Captured[] = [];
    const db = captureDb(captured);
    await handleTables(
      new Request('https://shareout.site/v1/data/art_1/tables/sales', {
        method: 'DELETE',
        body: JSON.stringify({ filter: { month: '2026-05' } }),
      }),
      ctx({ field: 'company_id', values: [3] }, db),
      'sales'
    );
    const del = captured.find((c) => c.sql.startsWith('DELETE FROM artifact_rows WHERE table_id = (SELECT id') && !c.sql.includes('RETURNING') && c.sql.includes('json_extract'));
    expect(del!.sql).toContain("json_extract(data, '$.month') = ?");
    expect(del!.sql).toContain("json_extract(data, '$.company_id') IN (?)");
    expect(del!.params).toEqual(['art_1', 'sales', '2026-05', 3]);
  });

  it('scopes filter-based update to the viewer rows only', async () => {
    const captured: Captured[] = [];
    const db = captureDb(captured);
    await handleTables(
      new Request('https://shareout.site/v1/data/art_1/tables/sales', {
        method: 'PATCH',
        body: JSON.stringify({ filter: { month: '2026-05' }, changes: { flagged: true } }),
      }),
      ctx({ field: 'company_id', values: [3] }, db),
      'sales'
    );
    const sel = captured.find((c) => c.sql.includes('SELECT r.id, r.data FROM artifact_rows'));
    expect(sel!.sql).toContain("json_extract(data, '$.company_id') IN (?)");
    expect(sel!.params).toEqual(['art_1', 'sales', '2026-05', 3]);
  });
});
