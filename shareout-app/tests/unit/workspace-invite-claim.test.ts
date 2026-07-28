import { describe, expect, it, vi } from 'vitest';
import {
  handleClaimInvite,
  resolveClaim,
  inviteLandingUrl,
  peekInvite,
  type InviteClaim,
} from '../../src/workspaces-invite-email';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

const user: AuthUser = { id: 'usr_invited', email: 'invitee@example.com', username: null };
const baseEnv = {} as Env;

function makeDbMock(handlers: {
  first?: (sql: string, ...a: unknown[]) => unknown;
  batch?: (stmts: unknown[]) => unknown;
} = {}): Env['DB'] {
  const db: Record<string, unknown> = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...a: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...a) ?? null),
        run: vi.fn(async () => ({ success: true })),
      })),
    })),
    batch: vi.fn(async (stmts: unknown[]) => handlers.batch?.(stmts) ?? []),
  };
  return db as unknown as Env['DB'];
}

async function jsonBody(r: Response): Promise<Record<string, unknown>> {
  return r.json() as Promise<Record<string, unknown>>;
}

function req(code: unknown): Request {
  return new Request('https://x/v1/invites/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

describe('handleClaimInvite', () => {
  it('returns 400 for an unknown code', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    const res = await handleClaimInvite(req('NOPE'), env, user);
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe('INVALID_CODE');
  });

  it('returns 400 for an already-claimed code', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM workspace_invite_claims WHERE code_hash')) {
            return { id: 'inv_1', workspace_id: 'w', user_id: user.id, email: user.email, expires_at: '2999-01-01', claimed_at: '2026-01-01' };
          }
          return null;
        },
      }),
    };
    const res = await handleClaimInvite(req('USED1-USED2'), env, user);
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe('CODE_USED');
  });

  it('rejects when the invite belongs to a different account', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM workspace_invite_claims WHERE code_hash')) {
            return { id: 'inv_1', workspace_id: 'w', user_id: 'usr_other', email: 'someone@else.com', expires_at: '2999-01-01', claimed_at: null };
          }
          if (sql.includes('expires_at <')) return { expired: 0 };
          return null;
        },
      }),
    };
    const res = await handleClaimInvite(req('GOOD1-GOOD2'), env, user);
    expect(res.status).toBe(403);
    expect((await jsonBody(res)).code).toBe('CODE_MISMATCH');
  });

  it('mints a token for a valid, unexpired, unclaimed code', async () => {
    const batch = vi.fn(async () => []);
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM workspace_invite_claims WHERE code_hash')) {
            return { id: 'inv_1', workspace_id: 'wsp_x', user_id: user.id, email: user.email, expires_at: '2999-01-01', claimed_at: null };
          }
          if (sql.includes('expires_at <')) return { expired: 0 };
          return null;
        },
        batch,
      }),
    };
    const res = await handleClaimInvite(req('GOOD1-GOOD2'), env, user);
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(String(body.token)).toMatch(/^so_/);
    expect(body.workspace_id).toBe('wsp_x');
    // token insert + claim mark-as-used run as a batch
    expect(batch).toHaveBeenCalledOnce();
  });
});

describe('resolveClaim (shared by web accept + agent claim)', () => {
  const claimRow = (over: Record<string, unknown> = {}) => ({
    id: 'inv_1', workspace_id: 'wsp_x', user_id: user.id, email: user.email,
    invited_by: 'usr_boss', claimed_at: null, expired: 0, ...over,
  });
  const dbReturning = (row: unknown) => makeDbMock({
    first: (sql) => (sql.includes('FROM workspace_invite_claims WHERE code_hash') ? row : null),
  });

  it('rejects an expired code (inline expiry)', async () => {
    const env = { ...baseEnv, DB: dbReturning(claimRow({ expired: 1 })) };
    const r = await resolveClaim(env, 'GOOD1-GOOD2', user);
    expect(r).toEqual({ ok: false, reason: 'CODE_EXPIRED' });
  });

  it('surfaces the invited email on a mismatch (for the masked-email accept page)', async () => {
    const env = { ...baseEnv, DB: dbReturning(claimRow({ user_id: 'usr_other', email: 'someone@else.com' })) };
    const r = await resolveClaim(env, 'GOOD1-GOOD2', user);
    expect(r).toEqual({ ok: false, reason: 'CODE_MISMATCH', invitedEmail: 'someone@else.com' });
  });

  it('resolves a valid code and carries invited_by for the accepted-notification', async () => {
    const env = { ...baseEnv, DB: dbReturning(claimRow()) };
    const r = await resolveClaim(env, 'GOOD1-GOOD2', user);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claim.invited_by).toBe('usr_boss');
  });

  it('matches by email when the session user id differs', async () => {
    const env = { ...baseEnv, DB: dbReturning(claimRow({ user_id: 'usr_precreated' })) };
    const r = await resolveClaim(env, 'GOOD1-GOOD2', user);
    expect(r.ok).toBe(true);
  });
});

describe('inviteLandingUrl', () => {
  const claim: InviteClaim = {
    id: 'inv_1',
    workspace_id: 'wsp_x',
    user_id: 'usr_invited',
    email: 'invitee@example.com',
    invited_by: 'usr_boss',
  };

  it('sends external members to /shared', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ slug: 'acme', member_class: 'external' }),
      }),
    };
    const url = await inviteLandingUrl(env, 'https://shareout.site', claim);
    expect(url).toBe('https://shareout.site/shared');
  });

  it('deep-links internals to the workspace subdomain on prod apex', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ slug: 'acme', member_class: 'internal' }),
      }),
    };
    const url = await inviteLandingUrl(env, 'https://shareout.site', claim);
    expect(url).toBe('https://acme.shareout.site/home');
  });

  it('falls back to apex /home?workspace= on localhost', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ slug: 'acme', member_class: 'internal' }),
      }),
    };
    const url = await inviteLandingUrl(env, 'http://localhost:55162', claim);
    expect(url).toBe('http://localhost:55162/home?workspace=wsp_x');
  });
});

describe('peekInvite', () => {
  it('returns null for unknown codes', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    await expect(peekInvite(env, 'NOPE1-NOPE2')).resolves.toBeNull();
  });

  it('returns workspace + inviter names for a live code', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM workspace_invite_claims')) {
            return { workspace_id: 'wsp_x', invited_by: 'usr_boss', claimed_at: null, expired: 0 };
          }
          if (sql.includes('FROM workspaces')) return { name: 'Acme Co' };
          if (sql.includes('FROM users')) return { name: 'Boss', email: 'boss@acme.com' };
          return null;
        },
      }),
    };
    await expect(peekInvite(env, 'GOOD1-GOOD2')).resolves.toEqual({
      workspaceName: 'Acme Co',
      inviterName: 'Boss',
    });
  });
});
