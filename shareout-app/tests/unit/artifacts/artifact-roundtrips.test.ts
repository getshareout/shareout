// vitest-isolate: role helpers keep module-level state.
// Artifact side-panel endpoints — D1 round-trip waves. Same DB double as
// home-roundtrips: every call is held until the test releases the whole pending set,
// so the number of releases is the number of sequential round trips.
import { describe, expect, it } from 'vitest';
import { handleGetVersions } from '../../../src/artifacts/versions';
import { handleGetCollaborators } from '../../../src/artifacts/collaborators';
import { handleFetch } from '../../../src/router/handle-fetch';
import { createSessionToken } from '../../../src/token';
import type { AuthUser } from '../../../src/api-auth';
import type { Env } from '../../../src/types';

type Row = Record<string, unknown>;
type Handler = (sql: string, args: unknown[]) => Row | Row[] | null;

function wavesDb(handler: Handler) {
  const pending: (() => void)[] = [];
  const calls: string[] = [];
  const later = <T>(v: T) => new Promise<T>((res) => pending.push(() => res(v)));
  const all = (sql: string, args: unknown[]) => { const r = handler(sql, args); return { results: Array.isArray(r) ? r : r ? [r] : [] }; };
  const DB = {
    prepare: (sql: string) => {
      const stmt = (args: unknown[]) => ({
        sql, args,
        first: () => { calls.push(sql); const r = handler(sql, args); return later(Array.isArray(r) ? (r[0] ?? null) : r); },
        all: () => { calls.push(sql); return later(all(sql, args)); },
        run: () => { calls.push(sql); return later({ success: true, meta: { changes: 1 } }); },
      });
      return { ...stmt([]), bind: (...args: unknown[]) => stmt(args) };
    },
    batch: (stmts: Array<{ sql: string; args: unknown[] }>) => { calls.push('batch'); return later(stmts.map((s) => all(s.sql, s.args))); },
  };
  async function settle<T>(p: Promise<T>): Promise<{ out: T; waves: number }> {
    let done = false;
    let out!: T;
    let err: unknown;
    p.then((v) => { done = true; out = v; }, (e) => { done = true; err = e; });
    let waves = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 0));
      if (done) break;
      if (!pending.length) throw new Error('stuck: no pending D1 call');
      waves++;
      pending.splice(0).forEach((f) => f());
    }
    if (err) throw err;
    return { out, waves };
  }
  return { env: { DB, SHAREOUT_BASE_URL: 'https://x.test', SESSION_SECRET: 'test-session-secret' } as unknown as Env, calls, settle };
}

const owner = { id: 'usr_owner', email: 'owner@example.com', username: null } as AuthUser;
const collab = { id: 'usr_collab', email: 'collab@example.com', username: null } as AuthUser;
const admin = { id: 'usr_admin', email: 'admin@example.com', username: null } as AuthUser;
const stranger = { id: 'usr_x', email: 'x@example.com', username: null } as AuthUser;
const ART = 'art_1';
const WS = 'wsp_1';

function handler(opts: { exists?: boolean } = {}): Handler {
  const exists = opts.exists ?? true;
  return (sql, args) => {
    if (sql.includes('FROM users WHERE id = ? OR identity_id')) return [{ id: args[0] as string, email: null, name: null, picture: null }];
    if (sql === 'SELECT id FROM artifacts WHERE id = ?') return exists ? { id: ART } : null;
    if (sql.includes('SELECT owner_id FROM artifacts')) return exists ? { owner_id: owner.id } : null;
    if (sql.includes('SELECT owner_id, workspace_id FROM artifacts')) return exists ? { owner_id: owner.id, workspace_id: WS } : null;
    if (sql.includes('SELECT owner_id, workspace_id, visibility FROM artifacts')) return exists ? { owner_id: owner.id, workspace_id: WS, visibility: 'workspace' } : null;
    if (sql.includes('SELECT workspace_id FROM artifacts')) return exists ? { workspace_id: WS } : null;
    if (sql.includes('SELECT email FROM users WHERE id = ?')) {
      const u = [owner, collab, admin, stranger].find((x) => x.id === args[0]);
      return u ? { email: u.email } : null;
    }
    if (sql.includes('SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?')) return args[1] === collab.email ? { role: 'viewer' } : null;
    if (sql.includes("member_class = 'internal'")) return args[1] === admin.id ? { role: 'admin' } : null;
    if (sql.includes('FROM versions v')) return [{ id: 'ver_1', version_no: 1, entrypoint: 'index.html', created_at: 'x' }];
    if (sql.includes('SELECT email, role, added_at FROM collaborators')) return [{ email: collab.email, role: 'viewer', added_at: 'x' }];
    return null;
  };
}

const get = (path: string) => new Request(`https://x.test${path}`);

describe('GET /v1/artifacts/:id/versions — waves (was 4–7 sequential)', () => {
  it('owner: 2 waves (existence + role, then versions + live + approvals)', async () => {
    const db = wavesDb(handler());
    const { out, waves } = await db.settle(handleGetVersions(get(`/v1/artifacts/${ART}/versions`), db.env, owner, ART));
    expect(out.status).toBe(200);
    expect(((await out.json()) as { versions: unknown[] }).versions).toHaveLength(1);
    expect(waves).toBeLessThanOrEqual(2);
  });

  it('collaborator: 3 waves', async () => {
    const db = wavesDb(handler());
    const { out, waves } = await db.settle(handleGetVersions(get(`/v1/artifacts/${ART}/versions`), db.env, collab, ART));
    expect(out.status).toBe(200);
    expect(waves).toBeLessThanOrEqual(3);
  });

  it('a stranger gets 403 and no version rows are read', async () => {
    const db = wavesDb(handler());
    const { out } = await db.settle(handleGetVersions(get(`/v1/artifacts/${ART}/versions`), db.env, stranger, ART));
    expect(out.status).toBe(403);
    expect(db.calls.some((s) => s.includes('FROM versions v'))).toBe(false);
  });

  it('a missing artifact is still 404, not 403', async () => {
    const db = wavesDb(handler({ exists: false }));
    const { out } = await db.settle(handleGetVersions(get(`/v1/artifacts/${ART}/versions`), db.env, stranger, ART));
    expect(out.status).toBe(404);
  });
});

describe('GET /v1/artifacts/:id/collaborators — waves (was 6 sequential)', () => {
  // The sharing-admin check runs alongside the role check, so every caller pays the same
  // waves; its role lookup is a KV hit on prod (no D1 wave there).
  it('owner: 3 waves', async () => {
    const db = wavesDb(handler());
    const { out, waves } = await db.settle(handleGetCollaborators(get(`/v1/artifacts/${ART}/collaborators`), db.env, owner, ART));
    expect(out.status).toBe(200);
    expect(waves).toBeLessThanOrEqual(3);
  });

  it('collaborator: 3 waves (was 5)', async () => {
    const db = wavesDb(handler());
    const { out, waves } = await db.settle(handleGetCollaborators(get(`/v1/artifacts/${ART}/collaborators`), db.env, collab, ART));
    expect(out.status).toBe(200);
    expect(waves).toBeLessThanOrEqual(3);
  });

  it('workspace admin (sharing-management path): 3 waves (was 7)', async () => {
    const db = wavesDb(handler());
    const { out, waves } = await db.settle(handleGetCollaborators(get(`/v1/artifacts/${ART}/collaborators`), db.env, admin, ART));
    expect(out.status).toBe(200);
    expect(((await out.json()) as { collaborators: unknown[] }).collaborators).toHaveLength(1);
    expect(waves).toBeLessThanOrEqual(3);
  });

  it('a stranger gets 403 and the list is never read', async () => {
    const db = wavesDb(handler());
    const { out } = await db.settle(handleGetCollaborators(get(`/v1/artifacts/${ART}/collaborators`), db.env, stranger, ART));
    expect(out.status).toBe(403);
    expect(db.calls.some((s) => s.includes('SELECT email, role, added_at FROM collaborators'))).toBe(false);
  });

  it('a missing artifact is still 404', async () => {
    const db = wavesDb(handler({ exists: false }));
    const { out } = await db.settle(handleGetCollaborators(get(`/v1/artifacts/${ART}/collaborators`), db.env, stranger, ART));
    expect(out.status).toBe(404);
  });
});

describe('GET /v1/artifacts/:id/analytics through the router — waves (was 7 sequential)', () => {
  const routed = async (db: ReturnType<typeof wavesDb>, user: AuthUser) => {
    const cookie = `shareout_session=${await createSessionToken(user.id, user.email!, db.env)}`;
    return handleFetch(new Request(`https://x.test/v1/artifacts/${ART}/analytics`, { headers: { Cookie: cookie } }), db.env);
  };

  it('owner: session + authz + one data wave', async () => {
    const db = wavesDb(handler());
    const { out, waves } = await db.settle(routed(db, owner));
    expect(out.status).toBe(200);
    expect(waves).toBeLessThanOrEqual(3);
    expect(out.headers.get('Server-Timing')).toContain('waves');
  });

  it('collaborator: same 3 waves (collaborator row loads with the artifact)', async () => {
    const db = wavesDb(handler());
    const { out, waves } = await db.settle(routed(db, collab));
    expect(out.status).toBe(200);
    expect(waves).toBeLessThanOrEqual(3);
  });

  it('workspace member: one more wave for the role', async () => {
    const db = wavesDb(handler());
    const { out, waves } = await db.settle(routed(db, admin));
    expect(out.status).toBe(200);
    expect(waves).toBeLessThanOrEqual(4);
  });

  it('a stranger gets 403 and no analytics rows are read', async () => {
    const db = wavesDb(handler());
    const { out } = await db.settle(routed(db, stranger));
    expect(out.status).toBe(403);
    expect(db.calls.some((s) => s.includes('analytics_daily') || s === 'batch')).toBe(false);
  });
});
