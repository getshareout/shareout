import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { routeAuth } from '../../../src/router/auth-router';
import { createFetchContext } from '../../../src/router/context';
import { createSessionToken } from '../../../src/token';
import { decryptCredentials } from '../../../src/data/connections/credentials';
import { applyMigrations, e } from '../helpers/migrated-db';

const KEY = 'test-credentials-key-32-chars!!';
const env = { ...e, CREDENTIALS_KEY: KEY, SHAREOUT_BASE_URL: 'https://shareout.test', SESSION_SECRET: 'f51-session-secret-32-chars-long!!', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', GITHUB_CLIENT_ID: 'gh', GITHUB_CLIENT_SECRET: 's' } as typeof e;
const ART = 'art_f51_victim';

beforeAll(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f51_victim', 'usr_f51_victim@f51.test', 'Victim')"),
    env.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f51_other', 'usr_f51_other@f51.test', 'Other')"),
    env.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, 'Victim', 'f51-victim', 'usr_f51_victim', 'private')").bind(ART),
  ]);
});
afterEach(() => vi.unstubAllGlobals());

const row = (provider: string) => env.DB.prepare(
  "SELECT encrypted_credentials, iv FROM connections WHERE scope_type='artifact' AND scope_id=? AND provider=?",
).bind(ART, provider).first<{ encrypted_credentials: string; iv: string }>();

const callback = async (flag: string, sessionUser?: string) => routeAuth(createFetchContext(
  new Request(`https://shareout.test/auth/callback?code=attacker-code&state=${btoa(JSON.stringify({ [flag]: true, artifactId: ART, returnUrl: '' }))}`, {
    headers: sessionUser ? { Cookie: `shareout_session=${await createSessionToken(sessionUser, `${sessionUser}@f51.test`, env)}` } : {},
  }),
  env,
))!;

const sheetsTokens = (tok: string) => vi.stubGlobal('fetch', vi.fn(async () => Response.json({ access_token: tok, refresh_token: 'r', expires_in: 3600, token_type: 'Bearer', scope: 's' })));
const githubTokens = () => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
  String(input).includes('api.github.com')
    ? Response.json({ login: 'owner', id: 1 })
    : Response.json({ access_token: 'gho_OWNER', token_type: 'bearer', scope: 'repo' })));

describe('f51 OAuth callback requires the artifact owner session', () => {
  it('blocks: cookieless or non-owner sheets callback stores nothing; owner session still stores', async () => {
    sheetsTokens('G_OWNER');
    const owner = await callback('shareoutSheetsAuth', 'usr_f51_victim');
    expect(owner.status).toBe(200);
    const r = (await row('google_sheets'))!;
    expect((await decryptCredentials(r.encrypted_credentials, r.iv, KEY)).access_token).toBe('G_OWNER');

    sheetsTokens('G_ATTACKER');
    for (const who of [undefined, 'usr_f51_other']) {
      const res = await callback('shareoutSheetsAuth', who);
      expect(res.status).toBe(400);
    }
    const after = (await row('google_sheets'))!;
    expect((await decryptCredentials(after.encrypted_credentials, after.iv, KEY)).access_token).toBe('G_OWNER');
  });

  it('blocks: cookieless or non-owner github callback stores nothing; owner session still stores', async () => {
    githubTokens();
    expect((await callback('shareoutGitHubAuth')).status).toBe(400);
    expect((await callback('shareoutGitHubAuth', 'usr_f51_other')).status).toBe(400);
    expect(await row('github')).toBeNull();
    expect((await callback('shareoutGitHubAuth', 'usr_f51_victim')).status).toBe(200);
    const r = (await row('github'))!;
    expect((await decryptCredentials(r.encrypted_credentials, r.iv, KEY)).token).toBe('gho_OWNER');
  });
});
