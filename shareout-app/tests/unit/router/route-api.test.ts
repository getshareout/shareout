import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { createFetchContext } from '../../../src/router/context';
import { routeApi } from '../../../src/router/api-router';

const routeMiscApi = vi.hoisted(() => vi.fn());

vi.mock('../../../src/router/api/admin', () => ({ routeAdminApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/funnel', () => ({ routeFunnelApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/perf', () => ({ routePerfApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/create', () => ({ routeCreateApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/misc', () => ({ routeMiscApi }));
vi.mock('../../../src/router/api/home', () => ({ routeHomeApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/folders', () => ({ routeFolderApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/artifacts', () => ({ routeArtifactApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/access-requests', () => ({ routeAccessRequestsApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/workspace-agent', () => ({ routeWorkspaceAgentApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/workspaces', () => ({ routeWorkspaceApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/scheduling', () => ({ routeSchedulingApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/metric-alerts', () => ({ routeMetricAlertsApi: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../src/router/api/features', () => ({ routeFeaturesApi: vi.fn().mockResolvedValue(null) }));

const env = {} as Env;

function ctx(path: string, method = 'GET') {
  return createFetchContext(new Request(`https://shareout.site${path}`, { method }), env);
}

beforeEach(() => {
  routeMiscApi.mockReset();
  routeMiscApi.mockResolvedValue(null);
});

afterEach(() => vi.restoreAllMocks());

describe('routeApi', () => {
  it('returns null when no sub-router matches', async () => {
    expect(await routeApi(ctx('/v1/unknown'))).toBeNull();
  });

  it('returns consistent JSON 500 when a sub-router throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    routeMiscApi.mockRejectedValue(new Error('boom'));

    const res = await routeApi(ctx('/v1/misc', 'GET'));
    expect(res?.status).toBe(500);
    expect(await res!.json()).toEqual({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
    expect(consoleError).toHaveBeenCalled();
    expect(consoleError.mock.calls[0][0]).toMatchObject({
      level: 'error',
      message: 'api route handler threw',
      event: 'api.handler_error',
      path: '/v1/misc',
      error_message: 'boom',
    });
  });
});
