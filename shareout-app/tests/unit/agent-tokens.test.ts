import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleCreateAgentToken, handleListAgentTokens, handleRevokeAgentToken } from '../../src/agent-tokens';
import { hasScope, SERVICE_SCOPES, type AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

const admin: AuthUser = { id: 'usr_admin', email: 'admin@example.com', username: null };

// Flexible D1 mock: routes prepare(sql).bind(...).{first,run,all} to per-sql handlers.
function makeEnv(opts: {
  role?: string | null;
  capture?: { sql: string; args: unknown[] }[];
  tokens?: unknown[];
  revokeChanges?: number;
} = {}): Env {
  const role = opts.role === undefined ? 'admin' : opts.role;
  return {
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: unknown[]) => {
          opts.capture?.push({ sql, args });
          return {
            first: vi.fn(async () => {
              if (sql.includes('FROM workspace_members WHERE workspace_id = ? AND user_id = ?')) {
                return role ? { role } : null;
              }
              return null;
            }),
            all: vi.fn(async () => ({ results: opts.tokens ?? [] })),
            run: vi.fn(async () => ({ success: true, meta: { changes: sql.startsWith('UPDATE') ? (opts.revokeChanges ?? 1) : 1 } })),
          };
        }),
      })),
    },
  } as unknown as Env;
}

afterEach(() => vi.restoreAllMocks());

describe('hasScope', () => {
  it('grants everything to non-service (human/personal) callers', () => {
    expect(hasScope(admin, 'data:write')).toBe(true);
    expect(hasScope(admin, 'artifacts:publish')).toBe(true);
  });

  it('enforces the scope list for service tokens', () => {
    const svc: AuthUser = {
      id: 'usr_agent', email: null, username: null,
      service: { tokenId: 'sot_1', workspaceId: 'wsp_1', scopes: ['data:read'] },
    };
    expect(hasScope(svc, 'data:read')).toBe(true);
    expect(hasScope(svc, 'data:write')).toBe(false);
    expect(hasScope(svc, 'artifacts:publish')).toBe(false);
  });
});

describe('handleCreateAgentToken', () => {
  function req(body: unknown): Request {
    return new Request('https://x/v1/workspaces/wsp_1/agent-tokens', { method: 'POST', body: JSON.stringify(body) });
  }

  it('forbids non-admins', async () => {
    const env = makeEnv({ role: 'member' });
    const res = await handleCreateAgentToken(req({ name: 'CI', scopes: ['data:write'] }), env, admin, 'wsp_1');
    expect(res.status).toBe(403);
  });

  it('rejects empty or invalid scopes', async () => {
    const env = makeEnv();
    const empty = await handleCreateAgentToken(req({ name: 'CI', scopes: [] }), env, admin, 'wsp_1');
    expect(empty.status).toBe(400);
    const bad = await handleCreateAgentToken(req({ name: 'CI', scopes: ['data:nuke'] }), env, admin, 'wsp_1');
    expect(bad.status).toBe(400);
  });

  it('requires a name', async () => {
    const env = makeEnv();
    const res = await handleCreateAgentToken(req({ scopes: ['data:write'] }), env, admin, 'wsp_1');
    expect(res.status).toBe(400);
  });

  it('mints a sot_ token, creates a service principal + membership, returns plaintext once', async () => {
    const capture: { sql: string; args: unknown[] }[] = [];
    const env = makeEnv({ capture });
    const res = await handleCreateAgentToken(
      req({ name: 'CI bot', scopes: ['artifacts:publish', 'data:write'] }),
      env, admin, 'wsp_1',
    );
    const body = await res.json() as { ok: boolean; token: string; shown_once: boolean; principal_user_id: string; scopes: string[] };

    expect(res.status).toBe(201);
    expect(body.token).toMatch(/^sot_[a-f0-9]{64}$/);
    expect(body.shown_once).toBe(true);
    expect(body.scopes).toEqual(['artifacts:publish', 'data:write']);

    const sqls = capture.map((c) => c.sql);
    expect(sqls.some((s) => s.includes('INSERT INTO users') && s.includes('is_service'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO workspace_members'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO tokens'))).toBe(true);
    // principal id is reused across users + member + token rows
    expect(body.principal_user_id).toMatch(/^usr_/);
  });
});

describe('handleListAgentTokens', () => {
  it('forbids non-admins', async () => {
    const env = makeEnv({ role: null });
    const res = await handleListAgentTokens(new Request('https://x'), env, admin, 'wsp_1');
    expect(res.status).toBe(403);
  });

  it('returns metadata with parsed scopes and revoked flag, no hash', async () => {
    const env = makeEnv({
      tokens: [
        { id: 'sot_1', name: 'CI', scopes: 'data:write,data:read', principal_user_id: 'usr_a', created_at: 't', last_used_at: null, expires_at: null, revoked_at: null },
        { id: 'sot_2', name: 'old', scopes: 'data:read', principal_user_id: 'usr_b', created_at: 't', last_used_at: null, expires_at: null, revoked_at: 't2' },
      ],
    });
    const res = await handleListAgentTokens(new Request('https://x'), env, admin, 'wsp_1');
    const body = await res.json() as { tokens: { scopes: string[]; revoked: boolean }[] };
    expect(res.status).toBe(200);
    expect(body.tokens[0].scopes).toEqual(['data:write', 'data:read']);
    expect(body.tokens[0].revoked).toBe(false);
    expect(body.tokens[1].revoked).toBe(true);
    expect(JSON.stringify(body)).not.toContain('token_hash');
  });
});

describe('handleRevokeAgentToken', () => {
  it('forbids non-admins', async () => {
    const env = makeEnv({ role: 'member' });
    const res = await handleRevokeAgentToken(new Request('https://x', { method: 'DELETE' }), env, admin, 'wsp_1', 'sot_1');
    expect(res.status).toBe(403);
  });

  it('404s when nothing was revoked', async () => {
    const env = makeEnv({ revokeChanges: 0 });
    const res = await handleRevokeAgentToken(new Request('https://x', { method: 'DELETE' }), env, admin, 'wsp_1', 'sot_x');
    expect(res.status).toBe(404);
  });

  it('soft-revokes an existing token', async () => {
    const capture: { sql: string; args: unknown[] }[] = [];
    const env = makeEnv({ revokeChanges: 1, capture });
    const res = await handleRevokeAgentToken(new Request('https://x', { method: 'DELETE' }), env, admin, 'wsp_1', 'sot_1');
    expect(res.status).toBe(200);
    expect(capture.some((c) => c.sql.includes('SET revoked_at = strftime'))).toBe(true);
  });
});

describe('SERVICE_SCOPES', () => {
  it('is the canonical action-scope list', () => {
    expect(SERVICE_SCOPES).toEqual(['artifacts:read', 'artifacts:publish', 'data:read', 'data:write']);
  });
});
