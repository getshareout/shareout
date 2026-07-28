import { describe, expect, it } from 'vitest';
import Errors, {
  configError,
  conflict,
  createError,
  errorJson,
  forbiddenAction,
  formatLimitError,
  formatSizeError,
  invalidParam,
  methodNotAllowed,
  missingParam,
  notFound,
  proxyError,
  rateLimitError,
  uploadError,
  validationError,
} from '../../src/data/errors';
import { DATA_ERRORS } from '../../src/types';

describe('createError', () => {
  it('overrides selected fields on a base error', () => {
    const error = createError(DATA_ERRORS.FORBIDDEN, {
      message: 'Custom forbidden',
      hint: 'Try logging in',
    });

    expect(error).toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Custom forbidden',
      hint: 'Try logging in',
    });
  });

  it('keeps base fields when overrides are omitted', () => {
    expect(createError(DATA_ERRORS.UNAUTHORIZED)).toEqual(DATA_ERRORS.UNAUTHORIZED);
  });

  it('applies all optional override fields', () => {
    expect(createError(DATA_ERRORS.INVALID_REQUEST, {
      message: 'Bad',
      hint: 'Hint',
      suggestion: 'Fix it',
      param: 'id',
      docs: 'https://docs.example.com',
    })).toMatchObject({
      message: 'Bad',
      hint: 'Hint',
      suggestion: 'Fix it',
      param: 'id',
      docs: 'https://docs.example.com',
    });
  });
});

describe('errorJson', () => {
  it('returns a JSON response with optional metadata and CORS headers', async () => {
    const response = errorJson(invalidParam('slug', 'Invalid slug', {
      hint: 'Use lowercase letters',
      suggestion: 'my-artifact',
    }), 'https://app.example.com');

    expect(response.status).toBe(400);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Invalid slug',
      code: 'INVALID_PARAM',
      hint: 'Use lowercase letters',
      suggestion: 'my-artifact',
      param: 'slug',
    });
  });

  it('omits optional body fields when not set on the error', async () => {
    const response = errorJson(configError('API_KEY'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Server configuration error',
      code: 'CONFIG_ERROR',
      hint: expect.any(String),
      suggestion: expect.any(String),
    });
  });

  it('includes docs in the JSON body when present', async () => {
    const response = errorJson(createError(DATA_ERRORS.INVALID_REQUEST, {
      docs: 'https://shareout.site/docs/errors',
    }));

    await expect(response.json()).resolves.toMatchObject({
      docs: 'https://shareout.site/docs/errors',
    });
  });
});

describe('parameter and validation helpers', () => {
  it('builds missing and invalid parameter errors', () => {
    expect(missingParam('key', 'user_settings')).toMatchObject({
      code: 'MISSING_PARAM',
      param: 'key',
      suggestion: 'Expected format: user_settings',
    });

    expect(missingParam('token')).toMatchObject({
      code: 'MISSING_PARAM',
      suggestion: undefined,
    });

    expect(invalidParam('page', 'Not a number')).toMatchObject({
      code: 'INVALID_PARAM',
      hint: 'The "page" parameter is invalid.',
    });

    expect(validationError('name', 'Too long', { maxLength: 50 })).toMatchObject({
      code: 'VALIDATION_ERROR',
      param: 'name',
      suggestion: expect.stringContaining('Max length: 50'),
    });

    expect(validationError('role', 'Invalid', {
      allowed: 'owner, editor, viewer',
      example: 'editor',
    })).toMatchObject({
      suggestion: 'Allowed: owner, editor, viewer. Example: "editor".',
    });

    expect(validationError('bio', 'Empty')).toMatchObject({
      suggestion: undefined,
    });
  });

  it('builds size and limit errors with human-readable hints', () => {
    expect(formatSizeError('FILE_TOO_LARGE', 'Upload too big', 1_000_000, 2_500_000)).toMatchObject({
      status: 413,
      hint: expect.stringContaining('2.50MB'),
    });

    expect(formatSizeError('FILE_TOO_LARGE', 'Upload too big', 5_000_000)).toMatchObject({
      hint: 'Maximum allowed size is 5.0MB.',
    });

    expect(formatLimitError('KEY_LIMIT', 'keys', 1000, 1000)).toMatchObject({
      message: 'Maximum keys limit reached (1000)',
      hint: 'Current count: 1000/1000',
    });

    expect(formatLimitError('KEY_LIMIT', 'keys', 1000)).toMatchObject({
      hint: 'Limit: 1000',
    });
  });
});

describe('resource helpers', () => {
  it('builds not-found and conflict errors with context', () => {
    expect(notFound('Dataset', 'sales-q1')).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Dataset not found',
      hint: expect.stringContaining('sales-q1'),
    });

    expect(conflict('Table', 'users')).toMatchObject({
      code: 'CONFLICT',
      hint: expect.stringContaining('users'),
    });
  });

  it('builds method and rate limit errors', () => {
    expect(methodNotAllowed('PATCH', ['GET', 'PUT'])).toMatchObject({
      code: 'METHOD_NOT_ALLOWED',
      suggestion: 'Allowed methods: GET, PUT',
    });

    expect(rateLimitError(60, 60_000, 15)).toMatchObject({
      code: 'RATE_LIMITED',
      hint: 'Try again in 15 seconds.',
    });

    expect(rateLimitError(100)).toMatchObject({
      message: expect.stringContaining('minute'),
      hint: 'Too many requests in a short period.',
    });
  });

  it('builds not-found errors without an identifier', () => {
    expect(notFound('Workspace')).toMatchObject({
      hint: 'The requested workspace does not exist.',
    });
  });
});

describe('operational error helpers', () => {
  it('builds config errors', () => {
    expect(configError('ANTHROPIC_API_KEY')).toMatchObject({
      code: 'CONFIG_ERROR',
      status: 500,
      hint: expect.stringContaining('ANTHROPIC_API_KEY'),
    });
  });

  it('builds proxy errors with optional status and message', () => {
    expect(proxyError('api.example.com')).toMatchObject({
      code: 'PROXY_ERROR',
      status: 502,
      hint: 'Request to api.example.com failed.',
    });

    expect(proxyError('api.example.com', 503)).toMatchObject({
      hint: 'Request to api.example.com failed. Status: 503.',
    });
  });

  it('builds upload errors for each stage', () => {
    expect(uploadError('token', 'Token expired')).toMatchObject({
      code: 'UPLOAD_ERROR',
      hint: 'Failed to generate upload URL.',
    });
    expect(uploadError('upload', 'Network reset')).toMatchObject({
      hint: 'Failed to upload file content.',
    });
    expect(uploadError('confirm', 'Checksum mismatch')).toMatchObject({
      hint: 'Failed to confirm upload completion.',
    });
  });

  it('builds forbidden errors with optional reason', () => {
    expect(forbiddenAction('delete this artifact')).toMatchObject({
      message: 'Cannot delete this artifact',
      hint: 'You do not have permission for this action.',
    });

    expect(forbiddenAction('publish', 'Viewers cannot publish')).toMatchObject({
      hint: 'Viewers cannot publish',
    });
  });
});

describe('Errors namespace', () => {
  it('exposes helper functions on the default export', () => {
    expect(Errors.respond).toBe(errorJson);
    expect(Errors.config('X')).toMatchObject({ code: 'CONFIG_ERROR' });
    expect(Errors.proxy('host')).toMatchObject({ code: 'PROXY_ERROR' });
    expect(Errors.upload('token', 'fail')).toMatchObject({ code: 'UPLOAD_ERROR' });
    expect(Errors.forbidden('act')).toMatchObject({ code: 'FORBIDDEN' });
  });
});
