import { describe, expect, it } from 'vitest';
import { routeAuth } from '../../../src/router/auth-router';
import { createFetchContext } from '../../../src/router/context';
import { e as env } from '../helpers/migrated-db';

const BASE = 'https://shareout.test';
const state = (flag: string) => btoa(JSON.stringify({ [flag]: true, artifactId: 'art_x', returnUrl: '' }));

async function hit(flag: string, qs: Record<string, string>) {
  const url = new URL(`${BASE}/auth/callback`);
  url.searchParams.set('state', state(flag));
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  const res = await routeAuth(createFetchContext(new Request(url), { ...env, SHAREOUT_BASE_URL: BASE }));
  return { res: res!, body: await res!.text() };
}

describe('f50 /auth/callback reflected XSS', () => {
  it('blocks: sheets error param is escaped in HTML and cannot break out of the script', async () => {
    const payload = `<img src=x onerror=alert(1)></script><script>alert(2)</script>`;
    const { body } = await hit('shareoutSheetsAuth', { error: payload });
    expect(body).not.toContain('<img src=x');
    expect(body).not.toContain('</script><script>alert');
    expect(body).toContain('&lt;img src=x');
    expect(body).toContain('\\u003c/script>');
  });

  it('blocks: github error_description is escaped in HTML and cannot break out of the script', async () => {
    const payload = `<script>alert(1)</script>";alert(2);//`;
    const { body } = await hit('shareoutGitHubAuth', { error: 'x', error_description: payload });
    expect(body).not.toContain('<script>alert(1)');
    expect(body).toContain('&lt;script&gt;alert(1)');
    expect(body).toContain('\\u003cscript>alert(1)');
  });

  it('keeps plain error text readable', async () => {
    const { res, body } = await hit('shareoutSheetsAuth', { error: 'access_denied' });
    expect(res.status).toBe(400);
    expect(body).toContain('<p>access_denied</p>');
  });
});
