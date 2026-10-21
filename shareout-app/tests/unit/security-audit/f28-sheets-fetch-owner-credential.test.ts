import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { storeArtifactTokens } from '../../../src/data/sheets/artifact-tokens';
import { applyMigrations, e } from '../helpers/migrated-db';

const ART = 'art_f28';
const OWNER_TOKEN = 'ya29.OWNER_DUMMY';
const POLICY = JSON.stringify({ version: 1, field: 'tenant', default: 'deny', rules: [] });

beforeAll(async () => {
  await applyMigrations();
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

  it('reproduces (NEEDS DECISION): anonymous visitor of an unscoped public artifact reads an arbitrary spreadsheet id with the owner token', async () => {
    const auth: (string | null)[] = [];
    vi.stubGlobal('fetch', async (_i: RequestInfo | URL, init?: RequestInit) => {
      auth.push(new Headers(init?.headers).get('Authorization'));
      return new Response(JSON.stringify({ values: [['secret']] }), { status: 200 });
    });
    const res = await handleDataRequest(
      new Request('https://so.test/v1/data/art_f28_open/sheets/fetch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId: 'idNotConfiguredByOwner', range: 'A1:B2', cache: false }),
      }), e, 'art_f28_open/sheets/fetch');
    expect(res.status).toBe(200);
    expect(auth).toEqual([`Bearer ${OWNER_TOKEN}`]);
  });
});
