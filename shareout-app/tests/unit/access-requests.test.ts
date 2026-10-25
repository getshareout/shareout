import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../../src/types';
import {
  createAccessRequestForSlug,
  decideAccessRequest,
  getPendingAccessRequest,
} from '../../src/artifacts/access-requests';

function makeEnv(overrides: Partial<Env> = {}): Env {
  const stmts: Array<{ sql: string; bind: unknown[]; run?: () => Promise<{ meta: { changes: number } }>; first?: () => Promise<unknown>; all?: () => Promise<{ results: unknown[] }> }> = [];

  const db = {
    prepare: (sql: string) => {
      const entry = { sql, bind: [] as unknown[], run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }), first: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue({ results: [] }) };
      stmts.push(entry);
      return {
        bind: (...args: unknown[]) => {
          entry.bind = args;
          return entry;
        },
      };
    },
    _stmts: stmts,
  };

  return { DB: db, SHAREOUT_BASE_URL: 'https://shareout.site', ...overrides } as unknown as Env;
}

describe('access requests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('createAccessRequestForSlug rejects when user has no email', async () => {
    const env = makeEnv();
    const result = await createAccessRequestForSlug(env, { id: 'usr_1', email: null }, 'demo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EMAIL_REQUIRED');
  });

  it('decideAccessRequest approves and adds viewer collaborator', async () => {
    const env = makeEnv();

    vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      const entry = {
        bind: (..._args: unknown[]) => entry,
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        first: vi.fn().mockImplementation(async () => {
          if (sql.includes('FROM access_requests ar')) {
            return {
              id: 'arq_1',
              artifact_id: 'art_1',
              requester_email: 'viewer@example.com',
              requester_name: 'Viewer',
              status: 'pending',
              artifact_name: 'Report',
              owner_id: 'usr_owner',
            };
          }
          if (sql.includes('SELECT id, role FROM collaborators')) return null;
          return null;
        }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      };
      return entry as never;
    });

    const result = await decideAccessRequest(env, 'usr_owner', 'arq_1', 'approve');
    expect(result.ok).toBe(true);
  });

  it('createAccessRequestForSlug does not re-notify after a recent denial', async () => {
    // The unique index only covers PENDING rows, so a denied requester could re-ask
    // immediately and re-ping the owner on a loop.
    const env = makeEnv();
    const inserted: string[] = [];

    vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO access_requests')) inserted.push(sql);
      const entry = {
        bind: (..._args: unknown[]) => entry,
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        first: vi.fn().mockImplementation(async () => {
          if (sql.includes('FROM deployments d')) {
            return { id: 'art_1', name: 'Report', owner_id: 'usr_owner', visibility: 'private' };
          }
          if (sql.includes("status = 'denied'")) return { 1: 1 };
          return null;
        }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      };
      return entry as never;
    });

    const result = await createAccessRequestForSlug(env, { id: 'usr_2', email: 'x@example.com' }, 'demo');
    expect(result).toEqual({ ok: true, status: 'pending' });
    expect(inserted).toHaveLength(0);
  });

  function mockDb(env: Env, firstFor: (sql: string) => unknown, calls: Array<{ sql: string; args: unknown[] }>) {
    vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      const entry = {
        bind: (...args: unknown[]) => { calls.push({ sql, args }); return entry; },
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        first: vi.fn().mockImplementation(async () => firstFor(sql)),
        all: vi.fn().mockResolvedValue({ results: [] }),
      };
      return entry as never;
    });
  }

  it('an edit request works on a workspace-visible page and stores role=editor', async () => {
    const env = makeEnv();
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    mockDb(env, (sql) => (sql.includes('FROM deployments d')
      ? { id: 'art_1', name: 'Report', owner_id: 'usr_owner', visibility: 'public' }
      : null), calls);

    const result = await createAccessRequestForSlug(env, { id: 'usr_2', email: 'x@example.com' }, 'demo', 'editor');
    expect(result).toEqual({ ok: true, status: 'created' });
    const insert = calls.find(c => c.sql.includes('INSERT INTO access_requests'));
    expect(insert?.args.at(-1)).toBe('editor');
  });

  it('a viewer collaborator may ask to edit, an editor may not', async () => {
    const env = makeEnv();
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    let collabRole = 'viewer';
    mockDb(env, (sql) => {
      if (sql.includes('FROM deployments d')) return { id: 'art_1', name: 'Report', owner_id: 'usr_owner', visibility: 'workspace' };
      if (sql.includes('FROM collaborators')) return { role: collabRole };
      return null;
    }, calls);

    expect((await createAccessRequestForSlug(env, { id: 'usr_2', email: 'x@example.com' }, 'demo', 'editor')).ok).toBe(true);
    collabRole = 'editor';
    const again = await createAccessRequestForSlug(env, { id: 'usr_2', email: 'x@example.com' }, 'demo', 'editor');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('HAS_ACCESS');
  });

  it('a pending view request upgrades to edit in place', async () => {
    const env = makeEnv();
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    mockDb(env, (sql) => {
      if (sql.includes('FROM deployments d')) return { id: 'art_1', name: 'Report', owner_id: 'usr_owner', visibility: 'private' };
      if (sql.includes("status = 'pending'")) return { id: 'arq_1', artifact_id: 'art_1', requester_user_id: 'usr_2', requester_email: 'x@example.com', requester_name: 'X', role: 'viewer', status: 'pending', created_at: '' };
      return null;
    }, calls);

    const result = await createAccessRequestForSlug(env, { id: 'usr_2', email: 'x@example.com' }, 'demo', 'editor');
    expect(result).toEqual({ ok: true, status: 'pending' });
    expect(calls.some(c => c.sql.includes("SET role = 'editor'") && c.args[0] === 'arq_1')).toBe(true);
    expect(calls.some(c => c.sql.includes('INSERT INTO access_requests'))).toBe(false);
  });

  it('approving an edit request adds an editor collaborator', async () => {
    const env = makeEnv();
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    mockDb(env, (sql) => (sql.includes('FROM access_requests ar')
      ? { id: 'arq_1', artifact_id: 'art_1', requester_email: 'x@example.com', requester_name: 'X', role: 'editor', status: 'pending', artifact_name: 'Report', artifact_slug: 'demo', owner_id: 'usr_owner', workspace_id: null }
      : null), calls);

    expect((await decideAccessRequest(env, 'usr_owner', 'arq_1', 'approve')).ok).toBe(true);
    const insert = calls.find(c => c.sql.includes('INSERT INTO collaborators'));
    expect(insert?.args[3]).toBe('editor');
  });

  it('getPendingAccessRequest returns null when none', async () => {
    const env = makeEnv();
    const row = await getPendingAccessRequest(env, 'art_1', 'usr_2');
    expect(row).toBeNull();
  });
});
