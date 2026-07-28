import { describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';

/** Agent flow: anonymous visitor + external fetch via platform proxy. */
describe(`15 agent visitor and proxy @ ${baseUrl}`, () => {
  const anon = ShareOutClient.anonymous();

  it('visitor loads ShareOut SDK', async () => {
    const response = await fetch(`${baseUrl}/sdk/shareout.js`);
    expect(response.ok).toBe(true);
    expect(await response.text()).toContain('ShareOut');
  });

  it('visitor cannot call management API without token', async () => {
    const { response } = await anon.request('/v1/artifacts');
    expect(response.status).toBe(401);
  });

  it('global proxy fetches a public HTTPS URL', async () => {
    const { response, text } = await anon.proxyFetch('https://example.com/');

    expect(response.status).toBe(200);
    expect(text.toLowerCase()).toContain('example');
  });

  it('global proxy blocks internal destinations', async () => {
    const { response, body } = await anon.proxyFetch('http://127.0.0.1/secret');

    expect(response.status).toBe(403);
    expect(body?.code).toBe('BLOCKED_DESTINATION');
  });
});
