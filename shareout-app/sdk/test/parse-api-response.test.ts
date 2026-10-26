import { describe, expect, it } from 'vitest';
import { parseApiResponse, wrapNetworkError } from '../src/internal/parse-api-response';
import { ShareOutError } from '../src/shareout-error';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseApiResponse', () => {
  it('returns data from a successful envelope', async () => {
    await expect(parseApiResponse(jsonResponse({ success: true, data: { ok: true } })))
      .resolves.toEqual({ ok: true });
  });

  it('throws ShareOutError for API error envelopes', async () => {
    await expect(parseApiResponse(jsonResponse({
      success: false,
      error: 'Missing key',
      code: 'KEY_NOT_FOUND',
    }, 404))).rejects.toMatchObject({
      name: 'ShareOutError',
      message: 'Missing key',
      code: 'KEY_NOT_FOUND',
      status: 404,
    });
  });

  it('passes through the actionable hint/suggestion/param/docs fields', async () => {
    await expect(parseApiResponse(jsonResponse({
      success: false,
      error: 'Connection not configured',
      code: 'CREDENTIALS_REQUIRED',
      hint: 'This connector needs your credentials.',
      suggestion: 'Save your token via PUT /v1/workspaces/{id}/connections/{id}/my-credentials',
      param: 'connection_id',
      docs: 'https://docs.shareout.site/connections',
    }, 400))).rejects.toMatchObject({
      code: 'CREDENTIALS_REQUIRED',
      hint: 'This connector needs your credentials.',
      suggestion: 'Save your token via PUT /v1/workspaces/{id}/connections/{id}/my-credentials',
      param: 'connection_id',
      docs: 'https://docs.shareout.site/connections',
    });
  });

  it('carries request_id and reason onto the error', async () => {
    await expect(parseApiResponse(jsonResponse({
      success: false,
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
      reason: 'expired',
      request_id: 'req_abc',
    }, 401))).rejects.toMatchObject({ requestId: 'req_abc', reason: 'expired' });
  });

  it('keeps request_id on ConsentRequiredError', async () => {
    await expect(parseApiResponse(jsonResponse({
      success: false,
      error: 'Consent required',
      code: 'CONSENT_REQUIRED',
      consent_url: 'https://example.com/consent',
      request_id: 'req_c',
    }, 403))).rejects.toMatchObject({ name: 'ConsentRequiredError', requestId: 'req_c' });
  });

  it('returns a bare (non-envelope) body only when bareBody is set', async () => {
    await expect(parseApiResponse(jsonResponse({ url: '/lib/a/b@1.0.0.js' }), { bareBody: true }))
      .resolves.toEqual({ url: '/lib/a/b@1.0.0.js' });
    await expect(parseApiResponse(jsonResponse({ success: true, data: { ok: 1 } }), { bareBody: true }))
      .resolves.toEqual({ ok: 1 });
    await expect(parseApiResponse(jsonResponse({ url: '/x' }))).resolves.toBeUndefined();
  });

  it('throws ShareOutError for non-JSON 5xx responses', async () => {
    const response = new Response('Bad Gateway', { status: 502 });
    await expect(parseApiResponse(response)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 502,
    });
  });

  it('throws ShareOutError for non-JSON 4xx responses', async () => {
    const response = new Response('Not Found', { status: 404 });
    await expect(parseApiResponse(response)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 404,
    });
  });
});

describe('wrapNetworkError', () => {
  it('passes through ShareOutError unchanged', () => {
    const err = new ShareOutError('Forbidden', 'FORBIDDEN', 403);
    expect(wrapNetworkError(err)).toBe(err);
  });

  it('wraps generic failures as NETWORK_ERROR', () => {
    expect(wrapNetworkError(new TypeError('Failed to fetch'))).toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });
});
