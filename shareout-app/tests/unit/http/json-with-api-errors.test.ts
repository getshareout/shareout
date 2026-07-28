// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jsonWithApiErrors } from '../../../src/http/api-error';
import { json as artifactJson } from '../../../src/artifacts/json-response';
import { json as publishJson } from '../../../src/publish/http';

describe('jsonWithApiErrors', () => {
  it('rewrites { error, code } on 4xx/5xx into the canonical envelope', async () => {
    const res = jsonWithApiErrors({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Forbidden',
      code: 'FORBIDDEN',
    });
  });

  it('preserves optional metadata fields on rewrite', async () => {
    const res = jsonWithApiErrors(
      { error: 'Bad', code: 'INVALID_PARAM', param: 'slug', hint: 'lowercase' },
      400
    );
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'INVALID_PARAM',
      param: 'slug',
      hint: 'lowercase',
    });
  });

  it('does not rewrite success payloads', async () => {
    const res = jsonWithApiErrors({ id: 'art_1', name: 'Hello' }, 200);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: 'art_1', name: 'Hello' });
  });

  it('does not double-wrap bodies that already set success', async () => {
    const res = jsonWithApiErrors(
      { success: false, error: 'Nope', code: 'FORBIDDEN', extra: true },
      403
    );
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Nope',
      code: 'FORBIDDEN',
      extra: true,
    });
  });

  it('artifact and publish json helpers share the same rewrite behavior', async () => {
    for (const helper of [artifactJson, publishJson]) {
      const res = helper({ error: 'Not found', code: 'NOT_FOUND' }, 404);
      await expect(res.json()).resolves.toMatchObject({
        success: false,
        code: 'NOT_FOUND',
      });
    }
  });

  it('merges extra headers (e.g. Set-Cookie, CORS) on both success and error', async () => {
    const ok = jsonWithApiErrors({ ok: true }, 200, { 'Set-Cookie': 'sid=1; Path=/' });
    expect(ok.headers.get('Set-Cookie')).toBe('sid=1; Path=/');

    const err = jsonWithApiErrors(
      { error: 'Bot check failed', code: 'TURNSTILE_FAILED' },
      403,
      { 'Access-Control-Allow-Origin': 'https://app.example.com' }
    );
    expect(err.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    await expect(err.json()).resolves.toMatchObject({
      success: false,
      code: 'TURNSTILE_FAILED',
    });
  });
});
