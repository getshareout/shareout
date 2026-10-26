// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CAPTURE_TTL_SEC, mintCaptureSessionToken } from '../../../src/auth/capture-session';
import type { Env } from '../../../src/types';

// A capture render (report email, PDF, thumbnail) reading a workspace-shared table
// through the data router with the render's read-only session.

const { stores } = vi.hoisted(() => ({ stores: new Map<string, unknown>() }));
vi.mock('../../../src/data/minidb-client', () => ({
  createMiniDb: (_env: unknown, artifactId: string) => stores.get(artifactId) ?? miniStore(),
}));

import { handleDataRequest } from '../../../src/data/router';

interface Row { id: string; name: string }

// Just enough of an artifact mini-store for table reads and the insert path.
function miniStore(tables: Record<string, Row[]> = {}) {
  const ids = Object.keys(tables);
  const answer = (sql: string, args: unknown[], mode: 'first' | 'all' | 'run') => {
    const rows = tables[args[1] as string] ?? [];
    if (mode === 'first') {
      if (sql.includes('SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?')) {
        return ids.includes(args[1] as string) ? { id: `tbl_${args[1]}` } : null;
      }
      if (sql.includes('SELECT COUNT(*) as total FROM artifact_rows r JOIN')) return { total: rows.length };
      if (sql.includes('SELECT COUNT(*) as count FROM artifact_rows r JOIN')) return { count: rows.length };
      return null;
    }
    if (mode === 'all') {
      if (sql.includes('SELECT r.data FROM artifact_rows r JOIN')) return rows.map((r) => ({ data: JSON.stringify(r) }));
      return [];
    }
    return null;
  };
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first() { return answer(sql, binds, 'first'); },
        async all() { return { results: answer(sql, binds, 'all') ?? [] }; },
        async run() { return { success: true, meta: { changes: 0 } }; },
      };
      return stmt;
    },
    async batch(stmts: Array<{ sql: string; bindings?: unknown[]; mode?: 'first' | 'all' | 'run' }>) {
      return stmts.map((s) => {
        const mode = s.mode ?? 'all';
        const out = answer(s.sql, s.bindings ?? [], mode);
        return mode === 'all' ? { results: out ?? [] } : { result: out };
      });
    },
  };
}

const ARTIFACTS: Record<string, { workspace_id: string; owner_id: string }> = {
  art_report: { workspace_id: 'ws_1', owner_id: 'usr_member' },
  art_orphan: { workspace_id: 'ws_1', owner_id: 'usr_left' },
};
const MEMBERS = new Set(['ws_1:usr_member']);
const GRANTS = [
  { workspace_id: 'ws_1', shared_name: 'leads', owner_artifact_id: 'art_crm', source_table_name: 'leads', access: 'read' },
  { workspace_id: 'ws_2', shared_name: 'rivals', owner_artifact_id: 'art_other', source_table_name: 'rivals', access: 'readwrite' },
];

const env = {
  SESSION_SECRET: 'session-secret',
  SHAREOUT_BASE_URL: 'https://shareout.example',
  DB: {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first() {
          if (sql.includes('FROM artifacts WHERE id = ?')) {
            const a = ARTIFACTS[binds[0] as string];
            return a ? {
              id: binds[0], name: 'Report', visibility: 'private', auth_method: null, access_policy: null,
              allow_anon_write: 0, allow_anon_email: 0, allow_anon_agent: 0, allow_anon_collab: 0, ...a,
            } : null;
          }
          if (sql.includes('FROM workspace_members WHERE workspace_id = ? AND user_id = ?')) {
            return MEMBERS.has(`${binds[0]}:${binds[1]}`) ? { role: 'member' } : null;
          }
          if (sql.includes('FROM workspace_shared_tables WHERE workspace_id = ? AND shared_name = ?')) {
            const g = GRANTS.find((x) => x.workspace_id === binds[0] && x.shared_name === binds[1]);
            return g ? { id: 'grant', ...g } : null;
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { success: true, meta: { changes: 0 } }; },
      };
      return stmt;
    },
  },
} as unknown as Env;

stores.set('art_crm', miniStore({ leads: [{ id: 'r1', name: 'Ana' }, { id: 'r2', name: 'Ben' }] }));

async function capture(artifactId: string, sub: string, init: { method?: string; body?: unknown } = {}) {
  const session = await mintCaptureSessionToken(env, artifactId, { linkExp: Math.floor(Date.now() / 1000) + CAPTURE_TTL_SEC });
  const request = new Request(`https://shareout.example/v1/data/${artifactId}${sub}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const response = await handleDataRequest(request, env, `${artifactId}${sub.split('?')[0]}`);
  return { response, body: await response.json() as { success: boolean; data?: Record<string, unknown>; error?: string } };
}

describe('capture render reading workspace shared tables', () => {
  it("renders a shared table's rows in a report capture", async () => {
    const { response, body } = await capture('art_report', '/workspace/tables/leads/query', { method: 'POST', body: {} });
    expect(response.status).toBe(200);
    expect((body.data?.rows as Row[]).map((r) => r.name)).toEqual(['Ana', 'Ben']);
  });

  it('counts a shared table too', async () => {
    const { response, body } = await capture('art_report', '/workspace/tables/leads/count', { method: 'POST', body: {} });
    expect(response.status).toBe(200);
    expect(body.data?.count).toBe(2);
  });

  it('still refuses writes to a shared table', async () => {
    for (const [sub, method] of [['/workspace/tables/leads', 'POST'], ['/workspace/tables/leads/r1', 'PATCH'], ['/workspace/tables/leads/r1', 'DELETE']] as const) {
      const { response, body } = await capture('art_report', sub, { method, body: { name: 'Zed' } });
      expect(response.status, `${method} ${sub}`).toBe(403);
      expect(body.error).toContain('read-only test run');
    }
  });

  it("cannot reach another workspace's shared tables", async () => {
    const { response } = await capture('art_report', '/workspace/tables/rivals/query', { method: 'POST', body: {} });
    expect(response.status).toBe(404);
  });

  it("reads nothing when the artifact's owner is not an internal member of its workspace", async () => {
    const { response } = await capture('art_orphan', '/workspace/tables/leads/query', { method: 'POST', body: {} });
    expect(response.status).toBe(403);
  });

  it('keeps workspace Knowledge search off: the session names no user', async () => {
    const { response } = await capture('art_report', '/knowledge/search?q=pricing');
    expect([401, 403]).toContain(response.status);
  });
});
