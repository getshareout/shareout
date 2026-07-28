import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleDisableSubdomain,
  handleEnableSubdomain,
  handleGetSubdomain,
} from '../../src/enterprise';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

// work/030 sweep: access code calls getInternalWorkspaceRole; alias it to the same
// mock fn so the existing mockResolvedValue(...) calls drive both.
const wsRoleMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/workspaces', () => ({
  getWorkspaceRole: wsRoleMock,
  getInternalWorkspaceRole: wsRoleMock,
}));

import { getInternalWorkspaceRole as getWorkspaceRole } from '../../src/workspaces';

const user: AuthUser = { id: 'usr_1', email: 'owner@example.com', username: null };
const workspaceId = 'wsp_abc123';
const baseEnv = { SHAREOUT_BASE_URL: 'https://shareout.site' } as Env;

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true }),
      })),
    })),
  } as unknown as Env['DB'];
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleGetSubdomain', () => {
  it('returns 403 when user is not a workspace member', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue(null);
    const env = { ...baseEnv, DB: makeDbMock() };
    const response = await handleGetSubdomain(env, user, workspaceId);
    expect(response.status).toBe(403);
  });

  it('returns 404 when workspace is missing', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('member');
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    const response = await handleGetSubdomain(env, user, workspaceId);
    expect(response.status).toBe(404);
  });

  it('returns disabled subdomain info; a member is eligible but cannot manage', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('member');
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => ({ slug: 'my-team', subdomain_enabled: 0 }) }),
    };
    const response = await handleGetSubdomain(env, user, workspaceId);
    const body = await jsonBody(response);

    expect(body.enabled).toBe(false);
    expect(body.subdomain).toBeNull();
    expect(body.workspace_slug).toBe('my-team');
    expect(body.eligible).toBe(true);
    expect(body.can_manage).toBe(false);
  });

  it('returns enabled subdomain info; an admin can manage when owner is on team', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('admin');
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => ({ slug: 'my-team', subdomain_enabled: 1 }) }),
    };
    const response = await handleGetSubdomain(env, user, workspaceId);
    const body = await jsonBody(response);

    expect(body.enabled).toBe(true);
    expect(body.subdomain).toBe('my-team.shareout.site');
    expect(body.eligible).toBe(true);
    expect(body.can_manage).toBe(true);
  });

  // This build has no plans. Eligibility used to follow the owner's paid tier, which
  // on a self-hosted instance — where every account reads as free — made custom
  // subdomains permanently unreachable despite being a documented feature.
  it('is eligible regardless of the workspace owner, and an admin can manage', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('admin');
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => ({ slug: 'my-team', subdomain_enabled: 0 }) }),
    };
    const response = await handleGetSubdomain(env, user, workspaceId);
    const body = await jsonBody(response);

    expect(body.eligible).toBe(true);
    expect(body.can_manage).toBe(true);
  });
});

describe('handleEnableSubdomain', () => {
  it('requires admin role', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('member');
    const env = { ...baseEnv, DB: makeDbMock() };
    const response = await handleEnableSubdomain(
      new Request('https://shareout.example.com/v1/workspaces/wsp/subdomain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(403);
    expect((await jsonBody(response)).code).toBe('ROLE_REQUIRED');
  });

  it('enables the subdomain without any plan check', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('admin');
    const run = vi.fn();
    const env = { ...baseEnv, DB: makeDbMock({ first: () => ({ slug: 'my-team' }), run }) };
    const response = await handleEnableSubdomain(
      new Request('https://shareout.example.com/v1/workspaces/wsp/subdomain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).subdomain).toBe('my-team.shareout.site');
    expect(run).toHaveBeenCalled();
  });

  it('allows an invited admin to enable it', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('admin');
    const run = vi.fn();
    const env = { ...baseEnv, DB: makeDbMock({ first: () => ({ slug: 'my-team' }), run }) };
    const response = await handleEnableSubdomain(
      new Request('https://shareout.example.com/v1/workspaces/wsp/subdomain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).subdomain).toBe('my-team.shareout.site');
    expect(run).toHaveBeenCalled();
  });

  it('rejects invalid JSON body', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('admin');
    const env = { ...baseEnv, DB: makeDbMock({ first: () => ({ slug: 'my-team' }) }) };
    const response = await handleEnableSubdomain(
      new Request('https://shareout.example.com/v1/workspaces/wsp/subdomain', {
        method: 'POST',
        body: '{bad',
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(400);
  });

  it('returns 404 when workspace is missing', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => null }),
    };
    const response = await handleEnableSubdomain(
      new Request('https://shareout.example.com/v1/workspaces/wsp/subdomain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(404);
  });

  it('rejects reserved subdomain slugs', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => ({ slug: 'admin' }) }),
    };
    const response = await handleEnableSubdomain(
      new Request('https://shareout.example.com/v1/workspaces/wsp/subdomain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      env,
      user,
      workspaceId,
    );
    expect(response.status).toBe(409);
    expect((await jsonBody(response)).code).toBe('SUBDOMAIN_RESERVED');
  });

  it('enables subdomain for a workspace admin', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('admin');
    const run = vi.fn();
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => ({ slug: 'my-team' }), run }),
    };
    const response = await handleEnableSubdomain(
      new Request('https://shareout.example.com/v1/workspaces/wsp/subdomain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      env,
      user,
      workspaceId,
    );
    const body = await jsonBody(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.subdomain).toBe('my-team.shareout.site');
    expect(run).toHaveBeenCalled();
  });

  it('disables subdomain via enable handler', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => ({ slug: 'my-team' }) }),
    };
    const response = await handleEnableSubdomain(
      new Request('https://shareout.example.com/v1/workspaces/wsp/subdomain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
      env,
      user,
      workspaceId,
    );
    const body = await jsonBody(response);

    expect(body.enabled).toBe(false);
    expect(body.subdomain).toBeNull();
  });
});

describe('handleDisableSubdomain', () => {
  it('requires admin role', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('member');
    const env = { ...baseEnv, DB: makeDbMock() };
    const response = await handleDisableSubdomain(env, user, workspaceId);
    expect(response.status).toBe(403);
  });

  it('disables subdomain', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('admin');
    const run = vi.fn();
    const env = { ...baseEnv, DB: makeDbMock({ run }) };
    const response = await handleDisableSubdomain(env, user, workspaceId);
    const body = await jsonBody(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.enabled).toBe(false);
    expect(body.subdomain).toBeNull();
    expect(run).toHaveBeenCalled();
  });
});
