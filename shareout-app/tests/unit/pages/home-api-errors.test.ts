// @vitest-environment node
// /v1/home write endpoints answer bad input with the standard error envelope.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const hostWorkspaceId = vi.hoisted(() => vi.fn());
const isLinkedWorkspaceMember = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId }));
vi.mock('../../../src/pages/home/filters', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isLinkedWorkspaceMember,
}));
vi.mock('../../../src/account-links', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getVisibilityScope: vi.fn(async () => ({ userIds: ['usr_1'] })),
}));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));

import { handleHomeDismissEventApi, handleHomeEventVisibilitySetApi } from '../../../src/pages/home/api';

const env = {} as Env;
const user = { id: 'usr_1', email: 'u@example.com' };

function req(path: string, method: string, body: string) {
  return new Request(`https://shareout.site${path}`, { method, body, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  hostWorkspaceId.mockResolvedValue(null);
  isLinkedWorkspaceMember.mockResolvedValue(true);
  getInternalWorkspaceRole.mockResolvedValue('owner');
});

describe('home write endpoints error envelope', () => {
  it('dismiss-event without ids', async () => {
    for (const body of ['{}', 'null']) {
      const res = await handleHomeDismissEventApi(req('/v1/home/dismiss-event', 'POST', body), env, user);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR', param: 'eventIds' });
    }
  });

  it('event-visibility without a workspace', async () => {
    const res = await handleHomeEventVisibilitySetApi(req('/v1/home/event-visibility', 'PUT', '{}'), env, user);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR', param: 'workspace' });
  });

  it('event-visibility with a bad kind', async () => {
    for (const body of ['{"kind":"nope","audience":"all"}', 'null']) {
      const res = await handleHomeEventVisibilitySetApi(req('/v1/home/event-visibility?workspace=wsp_1', 'PUT', body), env, user);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR', param: 'kind' });
    }
  });

  it('event-visibility as a plain member', async () => {
    getInternalWorkspaceRole.mockResolvedValue('member');
    const res = await handleHomeEventVisibilitySetApi(req('/v1/home/event-visibility?workspace=wsp_1', 'PUT', '{}'), env, user);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, code: 'FORBIDDEN' });
  });

  it('a workspace the caller does not belong to', async () => {
    isLinkedWorkspaceMember.mockResolvedValue(false);
    const res = await handleHomeEventVisibilitySetApi(req('/v1/home/event-visibility?workspace=wsp_x', 'PUT', '{}'), env, user);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, code: 'FORBIDDEN' });
  });
});
