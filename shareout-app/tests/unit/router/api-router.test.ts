import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { createApiRouter } from '../../../src/router/helpers/api-router';
import { createFetchContext } from '../../../src/router/context';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', () => ({ validateToken }));
vi.mock('../../../src/auth', () => ({ getSessionUser }));

const env = {} as Env;

function ctx(path: string, method = 'GET', headers: Record<string, string> = {}) {
  const req = new Request(`https://shareout.site${path}`, { method, headers });
  return createFetchContext(req, env);
}

beforeEach(() => {
  validateToken.mockReset();
  getSessionUser.mockReset();
  validateToken.mockResolvedValue(null);
  getSessionUser.mockResolvedValue(null);
});

afterEach(() => vi.restoreAllMocks());

describe('createApiRouter', () => {
  it('returns null when no route matches the path', async () => {
    const router = createApiRouter([
      { method: 'GET', path: '/v1/example', auth: 'none', handler: () => Response.json({ ok: true }) },
    ]);
    expect(await router(ctx('/v1/other'))).toBeNull();
  });

  it('returns 405 when the path matches but the method does not', async () => {
    const router = createApiRouter([
      { method: 'GET', path: '/v1/example', auth: 'none', handler: () => Response.json({ ok: true }) },
    ]);
    const res = await router(ctx('/v1/example', 'POST'));
    expect(res?.status).toBe(405);
    expect(await res!.json()).toEqual({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  });

  it('applies CORS on success responses', async () => {
    const router = createApiRouter([
      { method: 'GET', path: '/v1/example', auth: 'none', handler: () => Response.json({ ok: true }) },
    ]);
    const res = await router(ctx('/v1/example', 'GET', { Origin: 'https://shareout.site' }));
    expect(res?.status).toBe(200);
    expect(res?.headers.get('Access-Control-Allow-Origin')).toBe('https://shareout.site');
  });

  it('401s when session auth is required but missing', async () => {
    const router = createApiRouter([
      { method: 'GET', path: '/v1/secure', auth: 'session', handler: () => Response.json({ ok: true }) },
    ]);
    const res = await router(ctx('/v1/secure'));
    expect(res?.status).toBe(401);
    expect(res?.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('passes decoded path params to the handler', async () => {
    const router = createApiRouter([
      {
        method: 'GET',
        path: '/v1/items/:id',
        auth: 'none',
        handler: (_ctx, params) => Response.json({ id: params.id }),
      },
    ]);
    const res = await router(ctx('/v1/items/hello%20world'));
    expect(await res!.json()).toEqual({ id: 'hello world' });
  });

  it('accepts tokenOrSession auth via a browser cookie', async () => {
    getSessionUser.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
    const router = createApiRouter([
      {
        method: 'GET',
        path: '/v1/features',
        auth: 'tokenOrSession',
        handler: (_ctx, _params, user) => Response.json({ userId: user!.id }),
      },
    ]);
    const res = await router(ctx('/v1/features', 'GET', { Cookie: 'shareout_session=x' }));
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({ userId: 'user_1' });
  });

  it('returns 500 when the handler throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const router = createApiRouter([
      {
        method: 'GET',
        path: '/v1/boom',
        auth: 'none',
        handler: () => {
          throw new Error('boom');
        },
      },
    ]);
    const res = await router(ctx('/v1/boom'));
    expect(res?.status).toBe(500);
    expect(await res!.json()).toEqual({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    expect(consoleError).toHaveBeenCalled();
    expect(consoleError.mock.calls[0][0]).toMatchObject({
      level: 'error',
      message: 'api route handler threw',
      event: 'api.handler_error',
      path: '/v1/boom',
      error_message: 'boom',
    });
  });
});
