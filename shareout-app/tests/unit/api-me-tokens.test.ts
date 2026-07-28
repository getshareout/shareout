import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleListMyTokens, handleCreateMyToken } from '../../src/api-me-tokens';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

const user: AuthUser = { id: 'usr_1', email: 'me@example.com', username: null };

function makeDbMock(handlers: {
  all?: (sql: string, ...args: unknown[]) => unknown;
  run?: (sql: string, ...args: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        all: vi.fn(async () => handlers.all?.(sql, ...args) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, ...args) ?? { success: true, meta: { changes: 0 } }),
      })),
    })),
  } as unknown as Env['DB'];
}

afterEach(() => vi.restoreAllMocks());

describe('handleListMyTokens', () => {
  it('returns only the caller\'s token metadata, never plaintext', async () => {
    const rows = [{ id: 'tok_1', name: 'self-serve', created_at: '2026-01-01', last_used_at: null }];
    let boundUser: unknown;
    const env = {
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn((arg: unknown) => {
            boundUser = arg;
            return { all: vi.fn(async () => ({ results: sql.includes("principal_type = 'user' AND principal_id = ?") ? rows : [] })) };
          }),
        })),
      },
    } as unknown as Env;

    const res = await handleListMyTokens(env, user);
    const body = await res.json() as { ok: boolean; count: number; tokens: unknown[] };

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, count: 1, tokens: rows });
    expect(boundUser).toBe(user.id);
    expect(JSON.stringify(body)).not.toContain('token_hash');
  });
});

describe('handleCreateMyToken', () => {
  it('mints a so_ token for the caller and returns it exactly once', async () => {
    let inserted = false;
    let deleted = false;
    const env = {
      DB: makeDbMock({
        run: (sql) => {
          if (sql.startsWith('DELETE')) deleted = true;
          if (sql.startsWith('INSERT')) inserted = true;
          return { success: true, meta: { changes: 1 } };
        },
      }),
    } as unknown as Env;

    const res = await handleCreateMyToken(
      new Request('https://x/v1/me/tokens', { method: 'POST', body: '{}' }),
      env,
      user,
    );
    const body = await res.json() as { ok: boolean; token: string; shown_once: boolean };

    expect(body.ok).toBe(true);
    expect(body.shown_once).toBe(true);
    expect(body.token).toMatch(/^so_[a-f0-9]{64}$/);
    expect(inserted).toBe(true);
    expect(deleted).toBe(false);
  });

  it('revokes existing tokens first when regenerate is true', async () => {
    const order: string[] = [];
    const env = {
      DB: makeDbMock({
        run: (sql) => {
          order.push(sql.startsWith('DELETE') ? 'delete' : 'insert');
          return { success: true, meta: { changes: 2 } };
        },
      }),
    } as unknown as Env;

    const res = await handleCreateMyToken(
      new Request('https://x/v1/me/tokens', { method: 'POST', body: JSON.stringify({ regenerate: true }) }),
      env,
      user,
    );
    const body = await res.json() as { ok: boolean; token: string };

    expect(body.ok).toBe(true);
    expect(body.token).toMatch(/^so_/);
    expect(order).toEqual(['delete', 'insert']);
  });

  it('tolerates an empty body (plain generate)', async () => {
    const env = { DB: makeDbMock() } as unknown as Env;
    const res = await handleCreateMyToken(
      new Request('https://x/v1/me/tokens', { method: 'POST' }),
      env,
      user,
    );
    const body = await res.json() as { ok: boolean; token: string };
    expect(body.ok).toBe(true);
    expect(body.token).toMatch(/^so_/);
  });
});
