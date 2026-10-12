import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
const buildFeaturesPayload = vi.hoisted(() => vi.fn());
const hostWorkspaceId = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());

vi.mock('../../../src/api-auth', () => ({ validateToken }));
vi.mock('../../../src/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionUser,
}));
vi.mock('../../../src/features/flags', () => ({ buildFeaturesPayload }));
vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));

import { routeFeaturesApi } from '../../../src/router/api/features';
import { createFetchContext } from '../../../src/router/context';

const env = {} as Env;

function request(path: string, method = 'GET', headers: Record<string, string> = {}) {
  const req = new Request(`https://shareout.site${path}`, { method, headers });
  return routeFeaturesApi(createFetchContext(req, env));
}

beforeEach(() => {
  validateToken.mockReset();
  getSessionUser.mockReset();
  buildFeaturesPayload.mockReset();
  hostWorkspaceId.mockReset().mockResolvedValue(null);
  getInternalWorkspaceRole.mockReset().mockResolvedValue(null);
  validateToken.mockResolvedValue(null);
  getSessionUser.mockResolvedValue(null);
  buildFeaturesPayload.mockResolvedValue({ scope: { workspace_id: null }, features: {}, disabled: [] });
});

afterEach(() => vi.restoreAllMocks());

describe('routeFeaturesApi (createApiRouter)', () => {
  it('returns 405 for unsupported methods on /v1/features', async () => {
    const res = await request('/v1/features', 'POST');
    expect(res?.status).toBe(405);
    expect(await res!.json()).toEqual({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  });

  it('401s without auth', async () => {
    const res = await request('/v1/features');
    expect(res?.status).toBe(401);
  });

  it('returns feature payload for an authenticated session', async () => {
    getSessionUser.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
    const res = await request('/v1/features', 'GET', { Cookie: 'shareout_session=x' });
    expect(res?.status).toBe(200);
    expect(buildFeaturesPayload).toHaveBeenCalledWith(env, null);
  });

  it('resolves the host workspace on a workspace subdomain for a bearer caller who is a member', async () => {
    validateToken.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
    hostWorkspaceId.mockResolvedValue('wsp_host');
    getInternalWorkspaceRole.mockResolvedValue('member');
    const res = await request('/v1/features', 'GET', { Authorization: 'Bearer so_x' });
    expect(res?.status).toBe(200);
    expect(getInternalWorkspaceRole).toHaveBeenCalledWith(env, 'wsp_host', 'user_1');
    expect(buildFeaturesPayload).toHaveBeenCalledWith(env, 'wsp_host');
  });

  it('falls back to personal scope on a subdomain the caller is not a member of', async () => {
    validateToken.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
    hostWorkspaceId.mockResolvedValue('wsp_host');
    const res = await request('/v1/features', 'GET', { Authorization: 'Bearer so_x' });
    expect(res?.status).toBe(200);
    expect(buildFeaturesPayload).toHaveBeenCalledWith(env, null);
  });
});
