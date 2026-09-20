import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../src/types';
import type { AuthUser } from '../../src/api-auth';

const role = vi.fn();
vi.mock('../../src/workspaces', () => ({ getInternalWorkspaceRole: role }));

const {
  handleListVendorPackages,
  handleAddVendorPackage,
  handleRemoveVendorPackage,
} = await import('../../src/router/api/workspace-vendor-packages');

const user = { id: 'usr_1', email: 'a@b.c', username: null } as AuthUser;
const WS = 'wsp_1';

function makeEnv(rows: { package: string }[] = []) {
  const run = vi.fn().mockResolvedValue({});
  const env = {
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ all: async () => ({ results: rows }), run })),
        all: async () => ({ results: rows }),
      })),
    },
    SLUGS: { delete: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Env;
  return { env, run };
}

beforeEach(() => role.mockReset());

describe('vendor-packages API', () => {
  it('lists the built-ins, the instance extras and the workspace rows for a member', async () => {
    role.mockResolvedValue('member');
    const { env } = makeEnv([{ package: 'highcharts' }]);
    (env as { VENDOR_PACKAGES_EXTRA?: string }).VENDOR_PACKAGES_EXTRA = 'vis-network';

    const res = await handleListVendorPackages(env, user, WS);
    const body = await res.json() as {
      builtIn: string[]; instance: string[]; workspace: { package: string }[]; allowsAny: boolean;
    };
    expect(res.status).toBe(200);
    expect(body.builtIn).toContain('d3');
    expect(body.instance).toEqual(['vis-network']);
    expect(body.workspace[0].package).toBe('highcharts');
    expect(body.allowsAny).toBe(false);
  });

  it('refuses a non-member outright', async () => {
    role.mockResolvedValue(null);
    const { env } = makeEnv();
    expect((await handleListVendorPackages(env, user, WS)).status).toBe(403);
  });

  it('lets an admin add a package and invalidates the cache', async () => {
    role.mockResolvedValue('admin');
    const { env, run } = makeEnv();
    const req = new Request('https://x/v1/workspaces/wsp_1/vendor-packages', {
      method: 'POST', body: JSON.stringify({ package: 'highcharts' }),
    });

    const res = await handleAddVendorPackage(req, env, user, WS);
    expect(res.status).toBe(201);
    expect(run).toHaveBeenCalled();
    expect(env.SLUGS!.delete).toHaveBeenCalled();
  });

  it('refuses a plain member writing', async () => {
    role.mockResolvedValue('member');
    const { env, run } = makeEnv();
    const req = new Request('https://x', { method: 'POST', body: JSON.stringify({ package: 'highcharts' }) });
    const res = await handleAddVendorPackage(req, env, user, WS);
    expect(res.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects anything that is not an npm package name', async () => {
    role.mockResolvedValue('owner');
    const { env, run } = makeEnv();
    for (const bad of ['../etc/passwd', 'Chart.JS', '', 'a b']) {
      const req = new Request('https://x', { method: 'POST', body: JSON.stringify({ package: bad }) });
      const res = await handleAddVendorPackage(req, env, user, WS);
      expect(res.status).toBe(400);
      expect((await res.json() as { code: string }).code).toBe('INVALID_PACKAGE');
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('does not store a package that is already built in', async () => {
    role.mockResolvedValue('owner');
    const { env, run } = makeEnv();
    const req = new Request('https://x', { method: 'POST', body: JSON.stringify({ package: 'd3' }) });
    const res = await handleAddVendorPackage(req, env, user, WS);
    expect(res.status).toBe(200);
    expect((await res.json() as { added: boolean }).added).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('removes a package for an admin', async () => {
    role.mockResolvedValue('admin');
    const { env, run } = makeEnv();
    const res = await handleRemoveVendorPackage(env, user, WS, 'highcharts');
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalled();
  });
});
