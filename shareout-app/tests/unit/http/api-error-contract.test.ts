// @vitest-environment node
/**
 * Golden contract for the public API error envelope.
 * Any change to shape here is a breaking change for API clients / agents.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  apiErrorResponse,
  buildApiErrorBody,
  simpleApiError,
} from '../../../src/http/api-error';
import { errorJson, invalidParam } from '../../../src/data/errors';
import { errorResponse } from '../../../src/data/middleware';
import { DATA_ERRORS, type Env } from '../../../src/types';
import { withRequestLogging } from '../../../src/request-logging';

describe('api error envelope contract', () => {
  it('buildApiErrorBody always sets success:false, error, and code', () => {
    expect(buildApiErrorBody({ code: 'NOT_FOUND', message: 'Missing' })).toEqual({
      success: false,
      error: 'Missing',
      code: 'NOT_FOUND',
    });
  });

  it('includes optional fields and request_id when provided', () => {
    expect(
      buildApiErrorBody(
        {
          code: 'INVALID_PARAM',
          message: 'Bad slug',
          hint: 'use lowercase',
          suggestion: 'my-slug',
          param: 'slug',
          docs: 'https://example.com/docs',
        },
        'req_abc'
      )
    ).toEqual({
      success: false,
      error: 'Bad slug',
      code: 'INVALID_PARAM',
      request_id: 'req_abc',
      hint: 'use lowercase',
      suggestion: 'my-slug',
      param: 'slug',
      docs: 'https://example.com/docs',
    });
  });

  it('apiErrorResponse sets status, Content-Type, and X-Request-Id', async () => {
    const res = apiErrorResponse(
      { code: 'FORBIDDEN', message: 'Nope', status: 403, hint: 'login' },
      { requestId: 'cf-ray-1' }
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(res.headers.get('X-Request-Id')).toBe('cf-ray-1');
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Nope',
      code: 'FORBIDDEN',
      request_id: 'cf-ray-1',
      hint: 'login',
    });
  });

  it('simpleApiError matches the envelope', async () => {
    const res = simpleApiError('Invalid JSON', 'INVALID_JSON', 400);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Invalid JSON',
      code: 'INVALID_JSON',
    });
  });

  it('data-plane errorJson uses the same envelope', async () => {
    const res = errorJson(invalidParam('id', 'id required'), 'https://app.example.com');
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: 'id required',
      code: 'INVALID_PARAM',
      param: 'id',
    });
  });

  it('data middleware errorResponse uses the same envelope', async () => {
    const res = errorResponse(DATA_ERRORS.UNAUTHORIZED, 'https://app.example.com');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: DATA_ERRORS.UNAUTHORIZED.message,
      code: 'UNAUTHORIZED',
    });
  });

  it('unhandled exceptions never leak stack or err.message to clients', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await withRequestLogging(
      new Request('https://shareout.test/boom'),
      { LOG_LEVEL: 'info' } as Env,
      undefined,
      async () => {
        throw new Error('D1_ERROR: secret table credentials leaked');
      }
    );
    expect(res.status).toBe(500);
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('D1_ERROR');
    expect(JSON.stringify(body)).not.toContain('credentials');
    expect(body.request_id).toBeTruthy();
    spy.mockRestore();
  });
});
