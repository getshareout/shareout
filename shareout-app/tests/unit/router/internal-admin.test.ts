// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { routeInternalAdmin } from '../../../src/router/internal-admin';

const getAnalystContext = vi.hoisted(() => vi.fn());
const chatComplete = vi.hoisted(() => vi.fn());
const getBuildConfig = vi.hoisted(() => vi.fn());

vi.mock('../../../src/superadmin/pulse', () => ({
  getAdminPulse: vi.fn(),
  getAnalystContext,
  getAdminEvents: vi.fn(),
}));

vi.mock('../../../src/data/agent/anthropic', () => ({
  chatComplete,
  getBuildConfig,
}));

vi.mock('../../../src/observability/store', () => ({
  getRecentWebhooks: vi.fn().mockResolvedValue([]),
  getRecentErrors: vi.fn().mockResolvedValue([]),
}));

const SECRET = 'test-admin-bridge-secret';

const env = { ADMIN_BRIDGE_SECRET: SECRET } as Env;

function authedRequest(path: string, init?: RequestInit) {
  return new Request(`https://shareout.site${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
    },
    ...init,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAnalystContext.mockResolvedValue({ users: 1 });
  getBuildConfig.mockReturnValue({ provider: 'openai', apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' });
});

describe('routeInternalAdmin fail-closed auth', () => {
  it('returns 401 when ADMIN_BRIDGE_SECRET is unset (self-host default)', async () => {
    const res = await routeInternalAdmin(
      new Request('https://shareout.test/internal/admin/stats', {
        headers: { Authorization: 'Bearer anything' },
      }),
      {} as Env,
      '/internal/admin/stats',
    );
    expect(res?.status).toBe(401);
  });

  it('returns 401 with wrong bearer when secret is configured', async () => {
    const res = await routeInternalAdmin(
      new Request('https://shareout.test/internal/admin/stats', {
        headers: { Authorization: 'Bearer wrong-secret-value' },
      }),
      env,
      '/internal/admin/stats',
    );
    expect(res?.status).toBe(401);
  });
});

describe('routeInternalAdmin /ask', () => {
  it('returns 401 without bridge secret', async () => {
    const res = await routeInternalAdmin(
      new Request('https://shareout.site/internal/admin/ask', {
        method: 'POST',
        body: JSON.stringify({ question: 'how many users?' }),
      }),
      env,
      '/internal/admin/ask',
    );
    expect(res?.status).toBe(401);
  });

  it('returns 400 when question is missing', async () => {
    const res = await routeInternalAdmin(
      authedRequest('/internal/admin/ask', { body: JSON.stringify({}) }),
      env,
      '/internal/admin/ask',
    );
    expect(res?.status).toBe(400);
    expect(await res!.json()).toEqual({ error: 'question required' });
  });

  it('returns sanitized error when analyst completion fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    chatComplete.mockRejectedValue(new Error('D1_ERROR: no such table: analyst_snapshots'));

    const res = await routeInternalAdmin(
      authedRequest('/internal/admin/ask', { body: JSON.stringify({ question: 'how many users?' }) }),
      env,
      '/internal/admin/ask',
    );

    expect(res?.status).toBe(500);
    expect(await res!.json()).toEqual({ error: 'Analyst request failed' });
    expect(consoleError).toHaveBeenCalled();
    expect(consoleError.mock.calls[0][0]).toMatchObject({
      level: 'error',
      message: 'analyst ask failed',
      event: 'internal_admin.failed',
      route: 'ask',
      error_message: 'D1_ERROR: no such table: analyst_snapshots',
    });
  });

  it('maps upstream AI API failures without leaking provider bodies', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    chatComplete.mockRejectedValue(new Error('AI API error: 401 {"error":"invalid_api_key"}'));

    const res = await routeInternalAdmin(
      authedRequest('/internal/admin/ask', { body: JSON.stringify({ question: 'MRR?' }) }),
      env,
      '/internal/admin/ask',
    );

    expect(res?.status).toBe(500);
    const body = await res!.json();
    expect(body.error).toBe('AI request failed');
    expect(JSON.stringify(body)).not.toContain('invalid_api_key');
  });
});
