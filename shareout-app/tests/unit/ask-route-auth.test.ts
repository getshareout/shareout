import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';

// Auth collaborators behind requireTokenOrSession + the agent-scope gate.
const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
const hasScope = vi.hoisted(() => vi.fn());
vi.mock('../../src/api-auth', () => ({ validateToken, hasScope }));
vi.mock('../../src/auth', () => ({ getSessionUser }));

// Membership gate + the answer engine — assert routing/auth only.
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
vi.mock('../../src/workspaces', () => ({ getInternalWorkspaceRole }));
const askWorkspace = vi.hoisted(() => vi.fn());
vi.mock('../../src/search/ask-workspace', () => ({ askWorkspace }));

import { routeArtifactApi } from '../../src/router/api/artifacts';
import { createFetchContext } from '../../src/router/context';

const env = {} as Env;

function ask(body: unknown, headers: Record<string, string> = {}) {
  const req = new Request('https://shareout.site/v1/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return routeArtifactApi(createFetchContext(req, env));
}

beforeEach(() => {
  validateToken.mockReset();
  getSessionUser.mockReset();
  getInternalWorkspaceRole.mockReset();
  askWorkspace.mockReset();
  validateToken.mockResolvedValue(null); // no Bearer token
  getInternalWorkspaceRole.mockResolvedValue('admin');
  askWorkspace.mockResolvedValue({ answer: 'It went up.', citations: [{ artifact_id: 'art_1', title: 'Q3', url: '/a/q3/' }] });
});
afterEach(() => vi.restoreAllMocks());

describe('POST /v1/ask auth + scoping', () => {
  it('401s when neither token nor session is present', async () => {
    getSessionUser.mockResolvedValue(null);
    const res = await ask({ question: 'how is revenue?' });
    expect(res?.status).toBe(401);
    expect(askWorkspace).not.toHaveBeenCalled();
  });

  it('answers for a workspace member and returns citations', async () => {
    getSessionUser.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
    const res = await ask({ question: 'how is revenue?', workspace: 'wsp_1' }, { Cookie: 'shareout_session=x' });
    expect(res?.status).toBe(200);
    const json = (await res!.json()) as { citations: Array<{ artifact_id: string; url: string }> };
    expect(json.citations[0]).toEqual({ artifact_id: 'art_1', title: 'Q3', url: '/a/q3/' });
    expect(askWorkspace).toHaveBeenCalledWith(env, 'user_1', 'wsp_1', 'how is revenue?');
  });

  it('403s when the user is not a member of the requested workspace', async () => {
    getSessionUser.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
    getInternalWorkspaceRole.mockResolvedValue(null);
    const res = await ask({ question: 'q', workspace: 'wsp_other' }, { Cookie: 'shareout_session=x' });
    expect(res?.status).toBe(403);
    expect(askWorkspace).not.toHaveBeenCalled();
  });

  it('400s on a missing question', async () => {
    getSessionUser.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
    const res = await ask({ workspace: 'wsp_1' }, { Cookie: 'shareout_session=x' });
    expect(res?.status).toBe(400);
    expect(askWorkspace).not.toHaveBeenCalled();
  });
});
