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

  it('getPendingAccessRequest returns null when none', async () => {
    const env = makeEnv();
    const row = await getPendingAccessRequest(env, 'art_1', 'usr_2');
    expect(row).toBeNull();
  });
});
