import { beforeAll, describe, expect, it } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const ART = 'art_h5a_policy';
const POLICY = JSON.stringify({ version: 1, field: 'tenant', rules: [{ match: { email: 'viewer@x.test' }, values: ['A'] }], default: 'deny' });

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-h5a';
  await e.DB.batch([
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind('usr_h5a_owner', 'h5aowner@x.test'),
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind('usr_h5a_viewer', 'viewer@x.test'),
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, access_policy) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(ART, ART, `slug-${ART}`, 'usr_h5a_owner', 'private', POLICY),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_h5a', ?, 'viewer@x.test', 'viewer')").bind(ART),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_h5ae', ?, 'h5aowner@x.test', 'owner')").bind(ART),
  ]);
  await e.DB.batch([
    e.DB.prepare('INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, ?)').bind('ver_h5a', ART, 'index.html', '{}'),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_h5a', ?, 'ver_h5a', 'production', ?)").bind(ART, `slug-${ART}`),
  ]);
});

async function call(path: string, user: { id: string; email: string }, method = 'GET') {
  const token = await createSessionToken(user.id, user.email, e);
  return handleDataRequest(
    new Request(`https://so.test/v1/data/${ART}/${path}`, { method, headers: { Cookie: `shareout_session=${token}` } }),
    e, `${ART}/${path}`);
}

const viewer = { id: 'usr_h5a_viewer', email: 'viewer@x.test' };
const owner = { id: 'usr_h5a_owner', email: 'h5aowner@x.test' };

describe('h5 blobs and datasets tiers and row-level policy', () => {
  it('blocks: a policy-filtered viewer cannot list or read blobs and datasets', async () => {
    for (const p of ['blobs', 'blobs/storage', 'blobs/b1', 'blobs/b1/content', 'datasets', 'datasets/d1', 'datasets/d1/content', 'datasets/d1/stream', 'datasets/d1/download-url']) {
      expect(`${p} ${(await call(p, viewer)).status}`).toBe(`${p} 403`);
    }
  });

  it('blocks: batch cannot reach them either', async () => {
    const token = await createSessionToken(viewer.id, viewer.email, e);
    const res = await handleDataRequest(new Request(`https://so.test/v1/data/${ART}/batch`, {
      method: 'POST', headers: { Cookie: `shareout_session=${token}` },
      body: JSON.stringify({ requests: [{ path: '/blobs' }, { path: '/datasets' }] }),
    }), e, `${ART}/batch`);
    const body = await res.json() as { data: { results: Array<{ success: boolean }> } };
    expect(body.data.results.map(r => r.success)).toEqual([false, false]);
  });

  it('the owner still lists blobs and datasets', async () => {
    expect((await call('blobs', owner)).status).toBe(200);
    expect((await call('datasets', owner)).status).toBe(200);
  });
});
