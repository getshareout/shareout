import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';

// Auth collaborators behind requireTokenOrSession.
const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock('../../src/api-auth', () => ({ validateToken }));
vi.mock('../../src/auth', () => ({ getSessionUser }));

// Job + template handlers — we only assert routing/auth here.
const handleCreateJob = vi.hoisted(() => vi.fn());
vi.mock('../../src/scheduling/handler', () => ({
  handleCreateJob,
  handleListJobs: vi.fn(),
  handleGetJob: vi.fn(),
  handleGetJobLogs: vi.fn(),
  handleUpdateJob: vi.fn(),
  handleDeleteJob: vi.fn(),
  handleRunJob: vi.fn(),
}));
vi.mock('../../src/scheduling/templates-handler', () => ({
  handleCreateTemplate: vi.fn(),
  handleListTemplates: vi.fn(),
  handleGetTemplate: vi.fn(),
  handleUpdateTemplate: vi.fn(),
  handleDeleteTemplate: vi.fn(),
  handlePreviewTemplate: vi.fn(),
}));

import { routeSchedulingApi } from '../../src/router/api/scheduling';
import { createFetchContext } from '../../src/router/context';

const env = {} as Env;

beforeEach(() => {
  validateToken.mockReset();
  getSessionUser.mockReset();
  handleCreateJob.mockReset();
  validateToken.mockResolvedValue(null); // no Bearer token
  handleCreateJob.mockResolvedValue(new Response(JSON.stringify({ job: { id: 'job_1' } }), { status: 201 }));
});
afterEach(() => vi.restoreAllMocks());

describe('scheduling route auth (toolbar Notify me / Schedule)', () => {
  it('lets a browser session cookie create a job (no Bearer token)', async () => {
    getSessionUser.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
    const req = new Request('https://shareout.site/v1/jobs', {
      method: 'POST',
      headers: { Cookie: 'shareout_session=x', 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact_id: 'art_1', action: 'slack', schedule: '0 9 * * *', config: {} }),
    });
    const res = await routeSchedulingApi(createFetchContext(req, env));
    expect(res?.status).toBe(201);
    expect(handleCreateJob).toHaveBeenCalledOnce();
  });

  it('401s when neither token nor session is present', async () => {
    getSessionUser.mockResolvedValue(null);
    const req = new Request('https://shareout.site/v1/jobs', { method: 'POST', body: '{}' });
    const res = await routeSchedulingApi(createFetchContext(req, env));
    expect(res?.status).toBe(401);
    expect(handleCreateJob).not.toHaveBeenCalled();
  });
});
