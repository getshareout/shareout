// vitest-isolate: grant/role helpers keep module-level state.
// Inspector Comments + Details latency guard. Each D1 call is a network round-trip
// from the Worker, so what the user waits for is the number of sequential *waves*
// of queries, not the query count. This DB double holds every call until the test
// releases the whole pending set at once; the number of releases is the wave count.
import { describe, expect, it } from 'vitest';
import { queryArtifactComments } from '../../../src/pages/home/queries/comments';
import { handleHomeCommentsApi } from '../../../src/pages/home/api';
import { handleGetArtifact } from '../../../src/artifacts';
import type { Env } from '../../../src/types';

type Row = Record<string, unknown>;
type Handler = (sql: string, args: unknown[]) => Row | Row[] | null;

function wavesDb(handler: Handler) {
  const pending: (() => void)[] = [];
  const calls: string[] = [];
  const later = <T>(v: T) => new Promise<T>((res) => pending.push(() => res(v)));
  const DB = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: () => { calls.push(sql); const r = handler(sql, args); return later(Array.isArray(r) ? (r[0] ?? null) : r); },
        all: () => { calls.push(sql); const r = handler(sql, args); return later({ results: Array.isArray(r) ? r : [] }); },
        run: () => { calls.push(sql); return later({ success: true, meta: { changes: 1 } }); },
      }),
    }),
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
  return { env: { DB, SHAREOUT_BASE_URL: 'https://x.test' } as unknown as Env, calls, settle };
}

const member = { id: 'usr_m', email: 'm@x.com' };
const art = { id: 'art_1', visibility: 'workspace', workspace_id: 'wsp_1', owner_id: 'usr_owner' };

/** A workspace-visible artifact; `isMember` toggles the reader's internal membership. */
function handler(isMember: boolean, comments: Row[] = []): Handler {
  return (sql) => {
    if (sql.includes('SELECT identity_id FROM users')) return { identity_id: null };
    if (sql.includes('FROM users WHERE id = ?')) return { id: member.id, email: member.email, name: null, picture: null };
    if (sql.includes('SELECT 1 FROM artifacts a')) return null; // not owner / collaborator
    if (sql.includes('SELECT id FROM artifacts WHERE (id = ? OR slug = ?)')) return { id: art.id };
    if (sql.includes('visibility, workspace_id, owner_id FROM artifacts')) return art;
    if (sql.includes('workspace_members')) return isMember ? { role: 'member' } : null;
    if (sql.includes('FROM artifact_comments')) return comments;
    return null;
  };
}

describe('Inspector comments — D1 round-trip waves', () => {
  it('a member with no comments costs 3 waves (was 8 sequential round-trips)', async () => {
    const db = wavesDb(handler(true));
    const { out, waves } = await db.settle(queryArtifactComments(db.env, member, art.id, 200));
    expect(out).toEqual([]);
    expect(waves).toBeLessThanOrEqual(3);
  });

  it('a member sees the rows', async () => {
    const rows = [{ id: 'c1', parent_id: null, content: 'hi' }];
    const db = wavesDb(handler(true, rows));
    const { out } = await db.settle(queryArtifactComments(db.env, member, art.id, 200));
    expect(out).toEqual(rows);
  });

  it('a non-member still gets nothing, even though the rows were read', async () => {
    const db = wavesDb(handler(false, [{ id: 'c1', parent_id: null, content: 'secret' }]));
    const { out } = await db.settle(queryArtifactComments(db.env, member, art.id, 200));
    expect(out).toEqual([]);
  });

  it('GET /v1/home/comments?slug= resolves the artifact and applies the same check', async () => {
    const rows = [{ id: 'c1', parent_id: null, content: 'hi' }];
    const ok = wavesDb(handler(true, rows));
    const res = (await ok.settle(handleHomeCommentsApi(new Request('https://x.test/v1/home/comments?slug=demo'), ok.env, member))).out;
    expect(await res.json()).toEqual({ comments: rows, count: 1 });

    const denied = wavesDb(handler(false, rows));
    const res2 = (await denied.settle(handleHomeCommentsApi(new Request('https://x.test/v1/home/comments?slug=demo'), denied.env, member))).out;
    expect(await res2.json()).toEqual({ comments: [], count: 0 });
  });

  it('GET /v1/home/comments without artifactId or slug → 400', async () => {
    const db = wavesDb(handler(true));
    const res = (await db.settle(handleHomeCommentsApi(new Request('https://x.test/v1/home/comments'), db.env, member))).out;
    expect(res.status).toBe(400);
  });
});

describe('Inspector details (GET /v1/artifacts/:id) — D1 round-trip waves', () => {
  const detailRow = { ...art, name: 'Demo', slug: 'demo', paused: 0, auth_method: 'none', embed_allowed: 1, current_version: 1, is_favorite: 0 };
  function detailHandler(isMember: boolean, wsRole = 'member'): Handler {
    return (sql) => {
      if (sql.includes('is_favorite')) return detailRow;
      if (sql.includes('SELECT owner_id FROM artifacts')) return { owner_id: art.owner_id };
      if (sql.includes('SELECT email FROM users')) return { email: member.email };
      if (sql.includes('workspace_members')) return isMember ? { role: wsRole } : null;
      return null;
    };
  }
  const user = { ...member, username: null };

  it('a workspace member gets 200 in at most 4 waves (was 11)', async () => {
    const db = wavesDb(detailHandler(true));
    const { out, waves } = await db.settle(handleGetArtifact(new Request('https://x.test'), db.env, user, art.id));
    expect(out.status).toBe(200);
    expect(await out.json()).toMatchObject({ can_edit: false, can_delete: false, viewers: [] });
    expect(waves).toBeLessThanOrEqual(4);
  });

  it('a workspace admin can delete but not edit', async () => {
    const db = wavesDb(detailHandler(true, 'admin'));
    const { out } = await db.settle(handleGetArtifact(new Request('https://x.test'), db.env, user, art.id));
    expect(await out.json()).toMatchObject({ can_edit: false, can_delete: true });
  });

  it('a non-member still gets 403', async () => {
    const db = wavesDb(detailHandler(false));
    const { out } = await db.settle(handleGetArtifact(new Request('https://x.test'), db.env, user, art.id));
    expect(out.status).toBe(403);
  });
});
