import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { storeArtifactTokens } from '../../../src/data/sheets/artifact-tokens';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const ART = 'art_f28';
const OWNER_TOKEN = 'ya29.OWNER_DUMMY';
const POLICY = JSON.stringify({ version: 1, field: 'tenant', default: 'deny', rules: [] });

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-f28';
  (e as { CREDENTIALS_KEY?: string }).CREDENTIALS_KEY = 'test-key-32-chars-long-enough!!!';
  await e.DB.batch([
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind('usr_f28_owner', 'f28owner@x.test'),
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, access_policy) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(ART, ART, `slug-${ART}`, 'usr_f28_owner', 'public', POLICY),
  ]);
  await e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, ?)')
    .bind('art_f28_open', 'o', 'slug-f28-open', 'usr_f28_owner', 'public').run();
  await storeArtifactTokens(e, 'art_f28_open', { access_token: OWNER_TOKEN, refresh_token: 'r', expires_in: 3600 });
  await storeArtifactTokens(e, ART, { access_token: OWNER_TOKEN, refresh_token: 'r', expires_in: 3600 });
});

afterEach(() => vi.unstubAllGlobals());

describe('f28 sheets fetch', () => {
  it('blocks: a scoped viewer cannot read sheets with the owner credential', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return new Response(JSON.stringify({ values: [['secret']] }), { status: 200 });
    });
    const res = await handleDataRequest(
      new Request(`https://so.test/v1/data/${ART}/sheets/fetch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId: 'idNotConfiguredByOwner', range: 'A1:B2' }),
      }), e, `${ART}/sheets/fetch`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code ?? 'SCOPE_REQUIRED').toBe('SCOPE_REQUIRED');
    expect(calls).toEqual([]);
  });

  const ID_IN_SOURCE = 'ABCdef0123456789ABCdef0123456789ABCdef012345';
  const ID_SYNCED = 'SYNCed0123456789ABCdef0123456789ABCdef012345';
  const ID_ARBITRARY = 'ZZZarbitrary456789ABCdef0123456789ABCdef01';

  const stub = () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (i: RequestInfo | URL) => {
      urls.push(String(i));
      return new Response(JSON.stringify({ values: [['secret']] }), { status: 200 });
    });
    return urls;
  };
  const post = (id: string, headers: Record<string, string> = {}) =>
    handleDataRequest(
      new Request('https://so.test/v1/data/art_f28_open/sheets/fetch', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ spreadsheetId: id, range: 'A1:B2', cache: false }),
      }), e, 'art_f28_open/sheets/fetch');

  it('blocks: anonymous visitor cannot read an arbitrary spreadsheet id; ids in the deployed source or sheet_syncs work', async () => {
    await e.DB.batch([
      e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint) VALUES ('ver_f28', 'art_f28_open', 1, 'index.html')"),
      e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_f28', 'art_f28_open', 'ver_f28', 'production', 'slug-f28-open')"),
      e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES ('ast_f28', 'ver_f28', 'index.html', 'k/f28', 'text/html', 100, 'x')"),
      e.DB.prepare("INSERT INTO sheet_syncs (id, artifact_id, name, spreadsheet_id, target_table) VALUES ('ss_f28', 'art_f28_open', 'n', ?, 't')").bind(ID_SYNCED),
    ]);
    await e.ARTIFACTS.put('k/f28', new TextEncoder().encode(`<script>fetch('https://docs.google.com/spreadsheets/d/${ID_IN_SOURCE}/edit')</script>`));
    const urls = stub();

    const bad = await post(ID_ARBITRARY);
    expect(bad.status).toBe(403);
    expect(JSON.stringify(await bad.json())).toContain('SHEETS_NOT_IN_ARTIFACT');
    expect(urls).toEqual([]);

    expect((await post(ID_IN_SOURCE)).status).toBe(200);
    expect((await post(ID_SYNCED)).status).toBe(200);
    expect(urls).toHaveLength(2);
  });

  it('the owner can still read any spreadsheet id', async () => {
    const urls = stub();
    const token = await createSessionToken('usr_f28_owner', 'f28owner@x.test', e);
    const res = await post(ID_ARBITRARY, { Cookie: `shareout_session=${token}` });
    expect(res.status).toBe(200);
    expect(urls).toHaveLength(1);
  });
});
