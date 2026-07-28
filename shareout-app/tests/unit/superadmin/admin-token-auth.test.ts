// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';

const getSessionUser = vi.fn();
const validateToken = vi.fn();

vi.mock('../../../src/auth', () => ({ getSessionUser: (...a: unknown[]) => getSessionUser(...a) }));
vi.mock('../../../src/api-auth', () => ({ validateToken: (...a: unknown[]) => validateToken(...a) }));

const { requireSuperAdmin } = await import('../../../src/superadmin/auth');

const env = { INSTANCE_ADMIN_EMAILS: 'boss@acme.com' } as unknown as Env;
const req = () => new Request('https://acme.com/v1/admin/instance');

beforeEach(() => {
  getSessionUser.mockReset().mockResolvedValue(null);
  validateToken.mockReset().mockResolvedValue(null);
});

describe('requireSuperAdmin', () => {
  it('accepts a browser session belonging to an admin', async () => {
    getSessionUser.mockResolvedValue({ id: 'usr_1', email: 'boss@acme.com' });
    expect(await requireSuperAdmin(req(), env)).toEqual({ id: 'usr_1', email: 'boss@acme.com' });
  });

  // The reason for the token path: an agent configuring a fresh instance has no
  // browser session, and /v1/admin/instance is the surface that tells it what is unset.
  it('accepts a personal API token belonging to an admin', async () => {
    validateToken.mockResolvedValue({ id: 'usr_1', email: 'boss@acme.com', username: null });
    expect(await requireSuperAdmin(req(), env)).toEqual({ id: 'usr_1', email: 'boss@acme.com' });
  });

  // The security line. An sot_ token is a workspace-scoped agent credential; honouring
  // it here would let it provision workspaces and read instance config.
  it('refuses a service-account token even when its owner is an admin', async () => {
    validateToken.mockResolvedValue({
      id: 'usr_1',
      email: 'boss@acme.com',
      username: null,
      service: { workspaceId: 'wsp_1', scopes: ['artifacts:publish'] },
    });
    expect(await requireSuperAdmin(req(), env)).toBeNull();
  });

  it('refuses a personal token whose owner is not an admin', async () => {
    validateToken.mockResolvedValue({ id: 'usr_2', email: 'someone@acme.com', username: null });
    expect(await requireSuperAdmin(req(), env)).toBeNull();
  });

  it('refuses when neither a session nor a token is present', async () => {
    expect(await requireSuperAdmin(req(), env)).toBeNull();
  });

  // A signed-in non-admin must not be able to fall through to a token check and get in
  // on a different identity.
  it('does not fall back to the token when a non-admin session is present', async () => {
    getSessionUser.mockResolvedValue({ id: 'usr_2', email: 'someone@acme.com' });
    validateToken.mockResolvedValue({ id: 'usr_1', email: 'boss@acme.com', username: null });
    expect(await requireSuperAdmin(req(), env)).toBeNull();
    expect(validateToken).not.toHaveBeenCalled();
  });
});
