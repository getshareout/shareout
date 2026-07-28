// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataContext } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';
import { createAccessToken } from '../../../src/token';

let idSeq = 0;
vi.mock('../../../src/crypto-utils', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_id${++idSeq}`),
}));

// The proxy builds the owner artifact's mini-store via createMiniDb. Redirect it to
// a shared in-memory mock so the proxy reaches the owner's tables in tests.
const { miniRef } = vi.hoisted(() => ({ miniRef: { db: null as unknown } }));
vi.mock('../../../src/data/minidb-client', () => ({
  createMiniDb: () => miniRef.db,
}));

import { handleWorkspaceData } from '../../../src/data/workspace-shared';

const SESSION_SECRET = 'session-secret';

// ── Minimal mini-store mock: enough for getOrCreateTable + query + insert ──────
interface MiniTable { id: string; artifact_id: string; name: string; row_count: number; }
interface MiniRow { id: string; table_id: string; data: Record<string, unknown>; }

function makeMiniDb(seed?: { tables?: MiniTable[]; rows?: MiniRow[] }) {
  const tables: MiniTable[] = [...(seed?.tables ?? [])];
  const rows: MiniRow[] = [...(seed?.rows ?? [])];
  const exec = (sql: string, args: unknown[], mode: 'first' | 'all' | 'run') => {
    if (mode === 'first') {
      if (sql.includes('SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?')) {
        const t = tables.find((x) => x.artifact_id === args[0] && x.name === args[1]);
        return { result: t ? { id: t.id } : null };
      }
      if (sql.includes('SELECT COUNT(*) as count FROM artifact_tables')) {
        return { result: { count: tables.filter((x) => x.artifact_id === args[0]).length } };
      }
      if (sql.includes('SELECT row_count FROM artifact_tables WHERE id = ?')) {
        const t = tables.find((x) => x.id === args[0]);
        return { result: t ? { row_count: t.row_count } : null };
      }
      // opt-012: reads JOIN artifact_tables on (artifact_id, name) — args[0]=artifactId, args[1]=name
      if (sql.includes('SELECT COUNT(*) as total FROM artifact_rows r JOIN')) {
        const t = tables.find((x) => x.artifact_id === args[0] && x.name === args[1]);
        return { result: { total: t ? rows.filter((r) => r.table_id === t.id).length : 0 } };
      }
      return { result: null };
    }
    if (mode === 'all') {
      if (sql.includes('SELECT r.data FROM artifact_rows r JOIN')) {
        const t = tables.find((x) => x.artifact_id === args[0] && x.name === args[1]);
        return { results: t ? rows.filter((r) => r.table_id === t.id).map((r) => ({ data: JSON.stringify(r.data) })) : [] };
      }
      return { results: [] };
    }
    // run
    if (sql.includes('INSERT INTO artifact_tables')) {
      tables.push({ id: args[0] as string, artifact_id: args[1] as string, name: args[2] as string, row_count: 0 });
    } else if (sql.includes('INSERT INTO artifact_rows')) {
      rows.push({ id: args[0] as string, table_id: args[1] as string, data: JSON.parse(args[2] as string) });
    } else if (sql.includes('UPDATE artifact_tables SET row_count = row_count + ?')) {
      const t = tables.find((x) => x.id === args[1]);
      if (t) t.row_count += args[0] as number;
    }
    return { meta: { changes: 1 } };
  };
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first() { return exec(sql, binds, 'first').result ?? null; },
        async all() { return { results: exec(sql, binds, 'all').results ?? [] }; },
        async run() { return { success: true, meta: exec(sql, binds, 'run').meta ?? { changes: 0 } }; },
      };
      return stmt;
    },
    async batch(stmts: Array<{ sql: string; bindings?: unknown[]; mode?: 'first' | 'all' | 'run' }>) {
      return stmts.map((s) => exec(s.sql, s.bindings ?? [], s.mode ?? 'all'));
    },
    _state: { tables, rows },
  };
}

// ── Registry (D1) mock: workspace_shared_tables + artifacts owner lookup ──────
interface Grant { workspace_id: string; shared_name: string; owner_artifact_id: string; source_table_name: string; access: string; }

function makeRegistry(seed: { grants?: Grant[]; owners?: Record<string, string> } = {}) {
  const grants: Grant[] = [...(seed.grants ?? [])];
  const owners = seed.owners ?? {};
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first() {
          if (sql.includes('SELECT owner_id FROM artifacts WHERE id = ?')) {
            const o = owners[binds[0] as string];
            return o ? { owner_id: o } : null;
          }
          if (sql.includes('FROM workspace_shared_tables WHERE workspace_id = ? AND shared_name = ?')) {
            const g = grants.find((x) => x.workspace_id === binds[0] && x.shared_name === binds[1]);
            if (!g) return null;
            return sql.includes('owner_artifact_id FROM')
              ? { owner_artifact_id: g.owner_artifact_id }
              : { id: 'g', ...g };
          }
          return null;
        },
        async all() {
          if (sql.includes('FROM workspace_shared_tables WHERE workspace_id = ? ORDER BY')) {
            return { results: grants.filter((g) => g.workspace_id === binds[0]).map((g) => ({
              shared_name: g.shared_name, owner_artifact_id: g.owner_artifact_id,
              source_table_name: g.source_table_name, access: g.access,
            })) };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO workspace_shared_tables')) {
            // (id, workspace_id, shared_name, owner_artifact_id, source_table_name, access)
            grants.push({
              workspace_id: binds[1] as string, shared_name: binds[2] as string,
              owner_artifact_id: binds[3] as string, source_table_name: binds[4] as string, access: binds[5] as string,
            });
          } else if (sql.includes('UPDATE workspace_shared_tables SET source_table_name')) {
            const g = grants.find((x) => x.workspace_id === binds[2] && x.shared_name === binds[3]);
            if (g) { g.source_table_name = binds[0] as string; g.access = binds[1] as string; }
          } else if (sql.includes('DELETE FROM workspace_shared_tables')) {
            const i = grants.findIndex((x) => x.workspace_id === binds[0] && x.shared_name === binds[1]);
            if (i >= 0) grants.splice(i, 1);
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    _grants: grants,
  };
  return db;
}

function makeEnv(registry: ReturnType<typeof makeRegistry>): Env {
  return { DB: registry, SESSION_SECRET } as unknown as Env;
}

function makeCtx(artifactId: string, env: Env, opts: { workspaceId?: string; db?: unknown; ownerId?: string | null } = {}): DataContext {
  return {
    artifactId,
    workspaceId: opts.workspaceId ?? 'ws_1',
    artifact: { id: artifactId, name: 'A', visibility: 'public', auth_method: null, workspace_id: opts.workspaceId ?? 'ws_1', owner_id: opts.ownerId ?? null },
    db: (opts.db ?? makeMiniDb()) as DataContext['db'],
    env,
    origin: null,
    viewerScope: undefined,
  };
}

function wreq(artifactId: string, subPath: string, init: RequestInit = {}): Request {
  return new Request(`https://example.com/v1/data/${artifactId}/workspace${subPath}`, init);
}

beforeEach(() => { idSeq = 0; miniRef.db = makeMiniDb(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('workspace shared tables — guards', () => {
  it('blocks workspace data for artifacts with no workspace', async () => {
    const ctx = makeCtx('art_1', makeEnv(makeRegistry()), { workspaceId: '' });
    const res = await handleWorkspaceData(wreq('art_1', '/tables/x/query', { method: 'POST', body: '{}' }), ctx, '/tables/x/query');
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown shared table', async () => {
    const ctx = makeCtx('art_1', makeEnv(makeRegistry()));
    const res = await handleWorkspaceData(wreq('art_1', '/tables/ghost/query', { method: 'POST', body: '{}' }), ctx, '/tables/ghost/query');
    expect(res.status).toBe(404);
  });
});

describe('workspace shared tables — sharing (owner-gated)', () => {
  it('rejects share without owner auth', async () => {
    const ctx = makeCtx('art_owner', makeEnv(makeRegistry({ owners: { art_owner: 'u1' } })));
    const res = await handleWorkspaceData(
      wreq('art_owner', '/_share', { method: 'POST', body: JSON.stringify({ table: 'leads' }) }),
      ctx, '/_share'
    );
    expect(res.status).toBe(403);
  });

  it('lets the owner share a table and lists it', async () => {
    const registry = makeRegistry({ owners: { art_owner: 'u1' } });
    const env = makeEnv(registry);
    const token = await createAccessToken('art_owner', 'owner', env);
    const ctx = makeCtx('art_owner', env, { ownerId: 'u1' });

    const share = await handleWorkspaceData(
      wreq('art_owner', '/_share', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ table: 'leads', access: 'read' }) }),
      ctx, '/_share'
    );
    expect(share.status).toBe(201);
    expect(registry._grants).toHaveLength(1);
    expect(registry._grants[0]).toMatchObject({ shared_name: 'leads', owner_artifact_id: 'art_owner', access: 'read' });

    const list = await handleWorkspaceData(wreq('art_owner', '/_shares'), ctx, '/_shares');
    const body = await list.json() as { data: { shares: Array<{ sharedName: string; ownedByCaller: boolean }> } };
    expect(body.data.shares[0]).toMatchObject({ sharedName: 'leads', ownedByCaller: true });
  });

  it('rejects a shared name already owned by another artifact', async () => {
    const registry = makeRegistry({
      owners: { art_owner: 'u1' },
      grants: [{ workspace_id: 'ws_1', shared_name: 'leads', owner_artifact_id: 'art_other', source_table_name: 'leads', access: 'read' }],
    });
    const env = makeEnv(registry);
    const token = await createAccessToken('art_owner', 'owner', env);
    const ctx = makeCtx('art_owner', env, { ownerId: 'u1' });
    const res = await handleWorkspaceData(
      wreq('art_owner', '/_share', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ table: 'leads', as: 'leads' }) }),
      ctx, '/_share'
    );
    expect(res.status).toBe(409);
  });
});

describe('workspace shared tables — access enforcement', () => {
  const readGrant: Grant = { workspace_id: 'ws_1', shared_name: 'leads', owner_artifact_id: 'art_owner', source_table_name: 'leads', access: 'read' };

  it('blocks writes to a read-only shared table but allows reads', async () => {
    miniRef.db = makeMiniDb({
      tables: [{ id: 'tbl1', artifact_id: 'art_owner', name: 'leads', row_count: 1 }],
      rows: [{ id: 'row1', table_id: 'tbl1', data: { id: 'row1', name: 'Ana' } }],
    });
    const ctx = makeCtx('art_reader', makeEnv(makeRegistry({ grants: [readGrant] })));

    // write (insert) → 403
    const write = await handleWorkspaceData(
      wreq('art_reader', '/tables/leads', { method: 'POST', body: JSON.stringify({ name: 'Bob' }) }),
      ctx, '/tables/leads'
    );
    expect(write.status).toBe(403);

    // read (query) → 200 with the owner's row
    const read = await handleWorkspaceData(
      wreq('art_reader', '/tables/leads/query', { method: 'POST', body: '{}' }),
      ctx, '/tables/leads/query'
    );
    expect(read.status).toBe(200);
    const body = await read.json() as { data: { rows: Array<{ name: string }> } };
    expect(body.data.rows).toHaveLength(1);
    expect(body.data.rows[0].name).toBe('Ana');
  });

  it('allows writes to a read/write shared table, landing in the owner store', async () => {
    const mini = makeMiniDb({ tables: [{ id: 'tbl1', artifact_id: 'art_owner', name: 'leads', row_count: 0 }] });
    miniRef.db = mini;
    const rwGrant: Grant = { ...readGrant, access: 'readwrite' };
    const ctx = makeCtx('art_reader', makeEnv(makeRegistry({ grants: [rwGrant] })));

    const write = await handleWorkspaceData(
      wreq('art_reader', '/tables/leads', { method: 'POST', body: JSON.stringify({ name: 'Bob' }) }),
      ctx, '/tables/leads'
    );
    expect(write.status).toBe(201);
    // The row landed in the OWNER artifact's store, not the caller's.
    expect(mini._state.rows).toHaveLength(1);
    expect(mini._state.rows[0].data).toMatchObject({ name: 'Bob' });
  });
});
