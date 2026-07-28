// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { routeDemoApi } from '../../../src/router/api/demo';

const buildScenario = vi.hoisted(() => vi.fn());

vi.mock('../../../src/router/helpers/auth-guard', () => ({
  getTokenOrSessionUser: vi.fn().mockResolvedValue({ id: 'usr_admin', email: 'admin@shareout.site', username: null }),
}));

vi.mock('../../../src/superadmin/recipients', () => ({
  isSuperAdminEmail: vi.fn().mockReturnValue(true),
}));

vi.mock('../../../src/demo/scenarios', async (orig) => {
  const actual = await orig<typeof import('../../../src/demo/scenarios')>();
  return { ...actual, buildScenario };
});

const env = {
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ id: 'ws_demo', slug: 'demo-terra' }),
      }),
    }),
  },
  SHOWTIME: {
    idFromName: vi.fn().mockReturnValue('do-id'),
    get: vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ steps: 3 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    }),
  },
} as unknown as Env;

function ctx(path: string, body?: Record<string, unknown>) {
  const url = new URL(`https://shareout.site${path}`);
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    url,
    path: url.pathname,
    addCORS: (r: Response) => r,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => vi.restoreAllMocks());

describe('routeDemoApi /v1/demo/run', () => {
  it('returns sanitized SCENARIO_ERROR for internal build failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    buildScenario.mockRejectedValue(new Error('D1_ERROR: no such table: artifacts'));

    const res = await routeDemoApi(ctx('/v1/demo/run', { workspace: 'demo-terra', scenario: 'lanzamiento' }));
    const body = await res!.json();

    expect(res?.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: 'Scenario build failed',
      code: 'SCENARIO_ERROR',
    });
    expect(consoleError).toHaveBeenCalled();
    expect(consoleError.mock.calls[0][0]).toMatchObject({
      level: 'error',
      event: 'demo.scenario.failed',
      workspace: 'demo-terra',
      scenario: 'lanzamiento',
    });
  });

  it('preserves safe unknown-scenario message', async () => {
    buildScenario.mockRejectedValue(new Error('unknown scenario: missing'));

    const res = await routeDemoApi(ctx('/v1/demo/run', { workspace: 'demo-terra', scenario: 'missing' }));
    const body = await res!.json();

    expect(res?.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: 'unknown scenario: missing',
      code: 'SCENARIO_ERROR',
    });
  });
});
