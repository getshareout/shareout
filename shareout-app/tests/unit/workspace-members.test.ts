import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/workspaces-invite-email', () => ({
  createInviteClaim: vi.fn(async () => 'ABCDE-FGHJK'),
  sendInviteEmail: vi.fn(async () => {}),
}));

import {
  handleInviteWorkspaceMembers,
  handleListWorkspaceMemberMetrics,
} from '../../src/workspaces';
import { handleRevokeMemberTokens, handleCreateMemberToken } from '../../src/workspaces-tokens';
import { sendInviteEmail } from '../../src/workspaces-invite-email';
import type { AuthUser } from '../../src/api-auth';
import type { Env, WorkspaceRole } from '../../src/types';

const user: AuthUser = { id: 'usr_1', email: 'admin@example.com', username: null };
const workspaceId = 'wsp_abc123';
const baseEnv = {} as Env;

function makeDbMock(handlers: {
  first?: (sql: string, ...a: unknown[]) => unknown;
  all?: (sql: string, ...a: unknown[]) => unknown;
  run?: (sql: string, ...a: unknown[]) => unknown;
  batch?: (stmts: unknown[]) => unknown;
} = {}): Env['DB'] {
  const db: Record<string, unknown> = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...a: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...a) ?? null),
        all: vi.fn(async () => handlers.all?.(sql, ...a) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, ...a) ?? { success: true, meta: { changes: 1 } }),
      })),
    })),
    batch: vi.fn(async (stmts: unknown[]) => handlers.batch?.(stmts) ?? []),
  };
  return db as unknown as Env['DB'];
}

function roleFirst(actorRole: WorkspaceRole | null, extra?: (sql: string, ...a: unknown[]) => unknown) {
  return (sql: string, ...a: unknown[]) => {
    if (sql.includes('SELECT role FROM workspace_members')) {
      return actorRole ? { role: actorRole } : null;
    }
    return extra?.(sql, ...a) ?? null;
  };
}

async function jsonBody(r: Response): Promise<Record<string, unknown>> {
  return r.json() as Promise<Record<string, unknown>>;
}

afterEach(() => vi.clearAllMocks());

describe('handleInviteWorkspaceMembers', () => {
  it('returns 403 for non-admin', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const res = await handleInviteWorkspaceMembers(
      new Request('https://x/v1/workspaces/w/members/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: ['a@b.com'] }),
      }), env, user, workspaceId);
    expect(res.status).toBe(403);
  });

  it('returns 400 when emails is not an array', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const res = await handleInviteWorkspaceMembers(
      new Request('https://x/v1/workspaces/w/members/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: 'a@b.com' }),
      }), env, user, workspaceId);
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe('VALIDATION_ERROR');
  });

  it('invites new users and reports per-email results', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => {
          if (sql.includes('FROM users WHERE email')) return null; // both are new users
          return null;
        }),
        all: () => ({ results: [] }),
      }),
    };
    const res = await handleInviteWorkspaceMembers(
      new Request('https://x/v1/workspaces/w/members/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: ['new1@example.com', 'new2@example.com', 'new1@example.com'] }),
      }), env, user, workspaceId);
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    const results = body.results as Array<{ email: string; status: string }>;
    expect(results).toHaveLength(2); // deduped
    expect(results.every((r) => r.status === 'invited')).toBe(true);
    expect(sendInviteEmail).toHaveBeenCalledTimes(2);
  });

  it('skips emails outside the domain whitelist', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => {
          if (sql.includes('allowed_email_domains')) {
            return { allowed_email_domains: JSON.stringify(['allowed.com']), allowed_emails: null };
          }
          if (sql.includes('FROM users WHERE email')) return null;
          return null;
        }),
        all: () => ({ results: [] }),
      }),
    };
    const res = await handleInviteWorkspaceMembers(
      new Request('https://x/v1/workspaces/w/members/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: ['ok@allowed.com', 'no@blocked.com'] }),
      }), env, user, workspaceId);
    const results = (await jsonBody(res)).results as Array<{ email: string; status: string; reason?: string }>;
    const blocked = results.find((r) => r.email === 'no@blocked.com');
    expect(blocked?.status).toBe('skipped');
    expect(blocked?.reason).toBe('domain_not_allowed');
  });
});

describe('handleListWorkspaceMemberMetrics', () => {
  it('returns 403 when not a member', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const res = await handleListWorkspaceMemberMetrics(
      new Request('https://x/v1/workspaces/w/members/metrics'), env, user, workspaceId);
    expect(res.status).toBe(403);
  });

  it('maps cost from micro-usd and derives last_active', async () => {
    const nowSec = Math.floor(Date.parse('2026-06-01T00:00:00Z') / 1000);
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('member'),
        all: () => ({ results: [{
          user_id: 'usr_2', role: 'member', joined_at: '2026-01-01',
          email: 'm@example.com', name: 'Mem', last_login_at: null,
          pending: 1, artifact_count: 3, artifacts_30d: 1, view_count: 40, views_30d: 5,
          ai_tokens: 1234, ai_cost_micro_usd: 2_500_000, comment_count: 7, last_view_ts: nowSec,
        }] }),
      }),
    };
    const res = await handleListWorkspaceMemberMetrics(
      new Request('https://x/v1/workspaces/w/members/metrics'), env, user, workspaceId);
    expect(res.status).toBe(200);
    const members = (await jsonBody(res)).members as Array<Record<string, unknown>>;
    expect(members[0].ai_cost_usd).toBe(2.5);
    expect(members[0].pending).toBe(true);
    expect(members[0].last_active).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('member token actions', () => {
  it('revokes tokens for a member as admin', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...a) => {
          if (sql.includes('SELECT role FROM workspace_members') && a[1] === user.id) return { role: 'admin' };
          if (sql.includes('SELECT role FROM workspace_members') && a[1] === 'usr_2') return { role: 'member' };
          return null;
        },
        run: () => ({ success: true, meta: { changes: 2 } }),
      }),
    };
    const res = await handleRevokeMemberTokens(
      new Request('https://x', { method: 'DELETE' }), env, user, workspaceId, 'usr_2');
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).revoked).toBe(2);
  });

  it('rejects token actions on a non-member target', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...a) => {
          if (sql.includes('SELECT role FROM workspace_members') && a[1] === user.id) return { role: 'admin' };
          return null; // target not a member
        },
      }),
    };
    const res = await handleCreateMemberToken(
      new Request('https://x', { method: 'POST' }), env, user, workspaceId, 'usr_stranger');
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe('NOT_A_MEMBER');
  });

  it('mints a one-time token for a member as admin', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...a) => {
          if (sql.includes('SELECT role FROM workspace_members') && a[1] === user.id) return { role: 'owner' };
          if (sql.includes('SELECT role FROM workspace_members') && a[1] === 'usr_2') return { role: 'member' };
          return null;
        },
      }),
    };
    const res = await handleCreateMemberToken(
      new Request('https://x', { method: 'POST' }), env, user, workspaceId, 'usr_2');
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(String(body.token)).toMatch(/^so_/);
    expect(body.shown_once).toBe(true);
  });
});
