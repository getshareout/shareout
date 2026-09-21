import { describe, expect, it, vi } from 'vitest';

const roleMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/workspaces', () => ({ getInternalWorkspaceRole: roleMock }));

import {
  handleSetWorkspaceGatewayModel,
  handleDeleteWorkspaceGatewayModel,
} from '../../../../src/router/api/workspace-llm';
import type { Env } from '../../../../src/types';
import type { AuthUser } from '../../../../src/api-auth';

const user = { id: 'usr_1', email: 'a@example.com' } as AuthUser;
const wsId = 'wsp_1';

function envWithDb(run: ReturnType<typeof vi.fn>): Env {
  return {
    DB: {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run })) })),
    },
  } as unknown as Env;
}

function req(body: unknown): Request {
  return new Request('https://x/y', { method: 'PUT', body: JSON.stringify(body) });
}

describe('handleSetWorkspaceGatewayModel', () => {
  it('forbids a non-admin', async () => {
    roleMock.mockResolvedValueOnce('member');
    const res = await handleSetWorkspaceGatewayModel(req({ model: 'deepseek/deepseek-v4.1-flash' }), envWithDb(vi.fn()), user, wsId);
    expect(res.status).toBe(403);
  });

  it('rejects a model id with no provider prefix', async () => {
    roleMock.mockResolvedValueOnce('admin');
    const res = await handleSetWorkspaceGatewayModel(req({ model: 'gpt-4o' }), envWithDb(vi.fn()), user, wsId);
    expect(res.status).toBe(400);
  });

  it('saves a valid gateway model id', async () => {
    roleMock.mockResolvedValueOnce('owner');
    const run = vi.fn(async () => ({ success: true }));
    const res = await handleSetWorkspaceGatewayModel(req({ model: 'deepseek/deepseek-v4.1-flash' }), envWithDb(run), user, wsId);
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, gatewayModel: 'deepseek/deepseek-v4.1-flash' });
  });
});

describe('handleDeleteWorkspaceGatewayModel', () => {
  it('forbids a non-admin', async () => {
    roleMock.mockResolvedValueOnce(null);
    const res = await handleDeleteWorkspaceGatewayModel(envWithDb(vi.fn()), user, wsId);
    expect(res.status).toBe(403);
  });

  it('clears the override for an admin', async () => {
    roleMock.mockResolvedValueOnce('admin');
    const run = vi.fn(async () => ({ success: true }));
    const res = await handleDeleteWorkspaceGatewayModel(envWithDb(run), user, wsId);
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
