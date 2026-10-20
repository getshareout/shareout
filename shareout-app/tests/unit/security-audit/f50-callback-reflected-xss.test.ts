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
  it('CONFIRMS: sheets error param is reflected unescaped into HTML and breaks out of the JS string, no session, no CSP', async () => {
    const payload = `<img src=x onerror=alert(1)>';alert(2);//`;
    const { res, body } = await hit('shareoutSheetsAuth', { error: payload });
    expect(res.headers.get('Content-Type')).toBe('text/html');
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(body).toContain(`<p>${payload}</p>`);
    expect(body).toContain(`message: '${payload}' }`);
  });

  it('CONFIRMS: github error_description is reflected unescaped into HTML and the JS string', async () => {
    const payload = `<script>alert(1)</script>';alert(2);//`;
    const { res, body } = await hit('shareoutGitHubAuth', { error: 'x', error_description: payload });
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(body).toContain(`<p>${payload}</p>`);
    expect(body).toContain(`message: '${payload}'`);
  });
});
