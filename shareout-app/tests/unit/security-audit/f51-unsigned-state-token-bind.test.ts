import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { routeAuth } from '../../../src/router/auth-router';
import { createFetchContext } from '../../../src/router/context';
import { decryptCredentials } from '../../../src/data/connections/credentials';
import { applyMigrations, e } from '../helpers/migrated-db';

const KEY = 'test-credentials-key-32-chars!!';
const env = { ...e, CREDENTIALS_KEY: KEY, SHAREOUT_BASE_URL: 'https://shareout.test', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', GITHUB_CLIENT_ID: 'gh', GITHUB_CLIENT_SECRET: 's' } as typeof e;
const ART = 'art_f51_victim';

beforeAll(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f51_victim', 'victim@f51.test', 'Victim')"),
    env.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, 'Victim', 'f51-victim', 'usr_f51_victim', 'private')").bind(ART),
  ]);
});
afterEach(() => vi.unstubAllGlobals());

const row = (provider: string) => env.DB.prepare(
  "SELECT encrypted_credentials, iv FROM connections WHERE scope_type='artifact' AND scope_id=? AND provider=?",
).bind(ART, provider).first<{ encrypted_credentials: string; iv: string }>();

const callback = (flag: string) => routeAuth(createFetchContext(
  new Request(`https://shareout.test/auth/callback?code=attacker-code&state=${btoa(JSON.stringify({ [flag]: true, artifactId: ART, returnUrl: '' }))}`),
  env,
))!;

describe('f51 unsigned OAuth state binds attacker token to victim artifact', () => {
  it('CONFIRMS: cookieless sheets callback stores attacker Google token on victim artifact, then overwrites it', async () => {
    for (const tok of ['G_ATTACKER_1', 'G_ATTACKER_2']) {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ access_token: tok, refresh_token: 'r', expires_in: 3600, token_type: 'Bearer', scope: 's' })));
      const res = await callback('shareoutSheetsAuth');
      expect(res.status).toBe(200);
      const r = (await row('google_sheets'))!;
      expect((await decryptCredentials(r.encrypted_credentials, r.iv, KEY)).access_token).toBe(tok);
    }
  });

  it('CONFIRMS: cookieless github callback stores attacker GitHub token on victim artifact', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('api.github.com')
        ? Response.json({ login: 'attacker', id: 666 })
        : Response.json({ access_token: 'gho_ATTACKER', token_type: 'bearer', scope: 'repo' })));
    const res = await callback('shareoutGitHubAuth');
    expect(res.status).toBe(200);
    const r = (await row('github'))!;
    expect((await decryptCredentials(r.encrypted_credentials, r.iv, KEY)).token).toBe('gho_ATTACKER');
  });
});
