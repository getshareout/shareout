import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getWorkspaceAccessPolicy,
  handleGetWorkspaceAccessPolicy,
  handleUpdateWorkspaceAccessPolicy,
  handleAddWorkspaceMember,
  autoJoinWorkspacesByDomain,
  hasWorkspaceSignupAllowlist,
} from '../../src/workspaces';
import type { AuthUser } from '../../src/api-auth';
import type { Env, WorkspaceRole } from '../../src/types';

const admin: AuthUser = { id: 'usr_admin', email: 'admin@acme.example', username: null };
const workspaceId = 'wsp_gal';
const baseEnv = {} as Env;

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
        all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true }),
      })),
    })),
  } as unknown as Env['DB'];
}

function roleFirst(role: WorkspaceRole | null, extra?: (sql: string, ...args: unknown[]) => unknown) {
  return (sql: string, ...args: unknown[]) => {
    if (sql.includes('SELECT role FROM workspace_members')) {
      return role ? { role } : null;
    }
    return extra?.(sql, ...args) ?? null;
  };
}

function policyRow(domains: string[] | null, emails: string[] | null) {
  return {
    allowed_email_domains: domains ? JSON.stringify(domains) : null,
    allowed_emails: emails ? JSON.stringify(emails) : null,
  };
}

function putRequest(body: unknown): Request {
  return new Request('https://shareout.site/v1/workspaces/wsp_gal/access-policy', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.restoreAllMocks());

describe('getWorkspaceAccessPolicy', () => {
  it('parses stored JSON into arrays', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => policyRow(['acme.example'], ['x@partner.com']) }),
    };
    const policy = await getWorkspaceAccessPolicy(env, workspaceId);
    expect(policy).toEqual({
      allowed_domains: ['acme.example'],
      allowed_emails: ['x@partner.com'],
    });
  });

  it('returns empty arrays when columns are null', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => policyRow(null, null) }) };
    expect(await getWorkspaceAccessPolicy(env, workspaceId)).toEqual({
      allowed_domains: [],
      allowed_emails: [],
    });
  });

  it('returns null for a missing workspace', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    expect(await getWorkspaceAccessPolicy(env, workspaceId)).toBeNull();
  });
});

describe('handleGetWorkspaceAccessPolicy', () => {
  it('returns 403 for non-members', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst(null) }) };
    const res = await handleGetWorkspaceAccessPolicy(env, admin, workspaceId);
    expect(res.status).toBe(403);
  });

  it('returns the policy for a member', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: roleFirst('member', () => policyRow(['acme.example'], null)) }),
    };
    const res = await handleGetWorkspaceAccessPolicy(env, admin, workspaceId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed_domains: ['acme.example'], allowed_emails: [] });
  });
});

describe('handleUpdateWorkspaceAccessPolicy', () => {
  it('returns 403 for members (admin required)', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const res = await handleUpdateWorkspaceAccessPolicy(putRequest({ allowed_domains: ['a.co'] }), env, admin, workspaceId);
    expect(res.status).toBe(403);
  });

  it('normalizes domains and persists JSON', async () => {
    const run = vi.fn(() => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: roleFirst('admin', () => policyRow(null, null)), run }),
    };
    const res = await handleUpdateWorkspaceAccessPolicy(
      putRequest({ allowed_domains: ['@Acme.example', 'acme.example'] }),
      env, admin, workspaceId
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed_domains: ['acme.example'], allowed_emails: [] });
    const updateCall = run.mock.calls.find((c) => String(c[0]).includes('UPDATE workspaces'));
    expect(updateCall?.[1]).toBe(JSON.stringify(['acme.example']));
  });

  it('rejects invalid domains', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin', () => policyRow(null, null)) }) };
    const res = await handleUpdateWorkspaceAccessPolicy(putRequest({ allowed_domains: ['not a domain'] }), env, admin, workspaceId);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DOMAIN');
  });

  it('rejects invalid emails', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin', () => policyRow(null, null)) }) };
    const res = await handleUpdateWorkspaceAccessPolicy(putRequest({ allowed_emails: ['nope'] }), env, admin, workspaceId);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_EMAIL');
  });

  it('clears a list to null when given an empty array', async () => {
    const run = vi.fn(() => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: roleFirst('admin', () => policyRow(['acme.example'], null)), run }),
    };
    await handleUpdateWorkspaceAccessPolicy(putRequest({ allowed_domains: [] }), env, admin, workspaceId);
    const updateCall = run.mock.calls.find((c) => String(c[0]).includes('UPDATE workspaces'));
    expect(updateCall?.[1]).toBeNull();
  });
});

describe('handleAddWorkspaceMember access policy gate', () => {
  function addRequest(email: string): Request {
    return new Request('https://shareout.site/v1/workspaces/wsp_gal/members', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  it('blocks an email outside the allowed domains', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) =>
          sql.includes('allowed_email_domains') ? policyRow(['acme.example'], null) : null
        ),
      }),
    };
    const res = await handleAddWorkspaceMember(addRequest('outsider@evil.com'), env, admin, workspaceId);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('DOMAIN_NOT_ALLOWED');
  });

  it('allows an email matching an allowed domain', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => {
          if (sql.includes('allowed_email_domains')) return policyRow(['acme.example'], null);
          if (sql.includes('SELECT id FROM users')) return { id: 'usr_target' };
          return null; // member does not yet exist
        }),
      }),
    };
    const res = await handleAddWorkspaceMember(addRequest('new@acme.example'), env, admin, workspaceId);
    expect(res.status).toBe(200);
  });

  it('allows an explicitly listed email outside the domains', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => {
          if (sql.includes('allowed_email_domains')) return policyRow(['acme.example'], ['contractor@partner.com']);
          if (sql.includes('SELECT id FROM users')) return { id: 'usr_target' };
          return null;
        }),
      }),
    };
    const res = await handleAddWorkspaceMember(addRequest('contractor@partner.com'), env, admin, workspaceId);
    expect(res.status).toBe(200);
  });

  it('allows any email when no policy is set', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin', (sql) => {
          if (sql.includes('allowed_email_domains')) return policyRow(null, null);
          if (sql.includes('SELECT id FROM users')) return { id: 'usr_target' };
          return null;
        }),
      }),
    };
    const res = await handleAddWorkspaceMember(addRequest('anyone@anywhere.com'), env, admin, workspaceId);
    expect(res.status).toBe(200);
  });
});

describe('hasWorkspaceSignupAllowlist', () => {
  it('returns true when the email domain matches a workspace allowlist', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        all: () => ({
          results: [{ allowed_email_domains: JSON.stringify(['acme.example']), allowed_emails: null }],
        }),
      }),
    };
    expect(await hasWorkspaceSignupAllowlist(env, 'new@acme.example')).toBe(true);
  });

  it('returns true for an explicitly allowed email', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        all: () => ({
          results: [{ allowed_email_domains: null, allowed_emails: JSON.stringify(['contractor@partner.com']) }],
        }),
      }),
    };
    expect(await hasWorkspaceSignupAllowlist(env, 'contractor@partner.com')).toBe(true);
  });

  it('returns false when no workspace allowlist matches', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        all: () => ({
          results: [{ allowed_email_domains: JSON.stringify(['acme.example']), allowed_emails: null }],
        }),
      }),
    };
    expect(await hasWorkspaceSignupAllowlist(env, 'outsider@evil.com')).toBe(false);
  });
});

describe('autoJoinWorkspacesByDomain', () => {
  it('inserts membership for matching workspaces the user is not in', async () => {
    const run = vi.fn(() => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        all: () => ({
          results: [
            { id: 'wsp_match', allowed_email_domains: JSON.stringify(['acme.example']) },
            { id: 'wsp_other', allowed_email_domains: JSON.stringify(['nope.com']) },
          ],
        }),
        first: () => null, // not yet a member anywhere
        run,
      }),
    };
    await autoJoinWorkspacesByDomain(env, 'usr_new', 'someone@acme.example');
    const inserts = run.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO workspace_members'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][2]).toBe('wsp_match'); // workspace_id binding
    expect(inserts[0][3]).toBe('usr_new');
  });

  it('skips workspaces the user already belongs to', async () => {
    const run = vi.fn(() => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        all: () => ({ results: [{ id: 'wsp_match', allowed_email_domains: JSON.stringify(['acme.example']) }] }),
        first: () => ({ id: 'wsm_existing' }),
        run,
      }),
    };
    await autoJoinWorkspacesByDomain(env, 'usr_existing', 'someone@acme.example');
    expect(run.mock.calls.filter((c) => String(c[0]).includes('INSERT'))).toHaveLength(0);
  });

  it('does nothing for an email with no domain', async () => {
    const all = vi.fn(() => ({ results: [] }));
    const env = { ...baseEnv, DB: makeDbMock({ all }) };
    await autoJoinWorkspacesByDomain(env, 'usr_x', null);
    expect(all).not.toHaveBeenCalled();
  });
});
