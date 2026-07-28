import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';
import {
  createLogger,
  logError,
  normalizeRoute,
  sanitizeFields,
  sanitizeUrl,
} from '../../src/logging';
import { withRequestLogging } from '../../src/request-logging';

describe('normalizeRoute', () => {
  it('groups artifact IDs into :id', () => {
    expect(normalizeRoute('/v1/artifacts/art_abc123/files')).toBe('/v1/artifacts/:id/files');
  });

  it('groups artifact slugs under /a/', () => {
    expect(normalizeRoute('/a/demo/edit')).toBe('/a/:slug/edit');
  });

  it('groups data API artifact segments', () => {
    expect(normalizeRoute('/v1/data/my-slug/json/store')).toBe('/v1/data/:id/json/store');
  });

  it('preserves static route segments', () => {
    expect(normalizeRoute('/v1/auth/create-account')).toBe('/v1/auth/create-account');
  });
});

describe('sanitizeFields', () => {
  it('redacts sensitive keys', () => {
    expect(sanitizeFields({ authorization: 'Bearer secret', user_id: 'usr_1' })).toEqual({
      authorization: '[REDACTED]',
      user_id: 'usr_1',
    });
  });
});

describe('sanitizeUrl', () => {
  it('redacts sensitive query params', () => {
    const url = new URL('https://shareout.site/auth/callback?code=abc&state=xyz');
    expect(sanitizeUrl(url)).toBe('https://shareout.site/auth/callback?code=%5BREDACTED%5D&state=%5BREDACTED%5D');
  });
});

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes structured JSON payloads', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const env = { LOG_LEVEL: 'info' } as Env;
    const logger = createLogger(env, { request_id: 'req_1' });

    logger.info('hello', { status: 200 });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({
      level: 'info',
      message: 'hello',
      request_id: 'req_1',
      status: 200,
      service: 'shareout-worker',
    });
  });

  it('respects LOG_LEVEL', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const env = { LOG_LEVEL: 'error' } as Env;
    const logger = createLogger(env);

    logger.info('hidden');

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('logError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes error metadata', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger({ LOG_LEVEL: 'error' } as Env);
    const err = new Error('boom');

    logError(logger, 'failed', err, { scope: 'test' });

    expect(spy.mock.calls[0][0]).toMatchObject({
      level: 'error',
      message: 'failed',
      scope: 'test',
      error_name: 'Error',
      error_message: 'boom',
    });
  });
});

describe('withRequestLogging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs successful requests and adds X-Request-Id', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const request = new Request('https://shareout.site/v1/skill', {
      headers: { 'cf-ray': 'ray-123' },
    });
    const env = { LOG_LEVEL: 'info' } as Env;

    const response = await withRequestLogging(request, env, undefined, async () =>
      new Response('ok', { status: 200 })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-Id')).toBe('ray-123');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toMatchObject({
      event: 'http.request',
      status: 200,
      route: '/v1/skill',
      outcome: 'success',
    });
  });

  it('logs 5xx responses as errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('https://shareout.site/v1/publish', { method: 'POST' });
    const env = { LOG_LEVEL: 'info' } as Env;

    await withRequestLogging(request, env, undefined, async () =>
      new Response('fail', { status: 500 })
    );

    expect(spy.mock.calls[0][0]).toMatchObject({
      level: 'error',
      status: 500,
      outcome: 'http_error',
    });
  });

  it('catches unhandled exceptions', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('https://shareout.site/broken');
    const env = { LOG_LEVEL: 'info' } as Env;

    const response = await withRequestLogging(request, env, undefined, async () => {
      throw new Error('unexpected');
    });

    expect(response.status).toBe(500);
    expect(spy.mock.calls[0][0]).toMatchObject({
      outcome: 'exception',
      error_message: 'unexpected',
    });
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
    expect(body.request_id).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('unexpected');
    spy.mockRestore();
  });
});
