import { beforeAll, describe, expect, it } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const ART = 'art_f27_policy';
const POLICY = JSON.stringify({ version: 1, field: 'tenant', rules: [{ match: { email: 'viewer@x.test' }, values: ['A'] }], default: 'deny' });

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-f27';
  await e.DB.batch([
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind('usr_f27_owner', 'f27owner@x.test'),
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind('usr_f27_viewer', 'viewer@x.test'),
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, access_policy) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(ART, ART, `slug-${ART}`, 'usr_f27_owner', 'private', POLICY),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_f27', ?, 'viewer@x.test', 'viewer')").bind(ART),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_f27e', ?, 'f27owner@x.test', 'owner')").bind(ART),
  ]);
  await e.DB.batch([
    e.DB.prepare('INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, ?)').bind('ver_f27', ART, 'index.html', '{}'),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_f27', ?, 'ver_f27', 'production', ?)").bind(ART, `slug-${ART}`),
  ]);
});

async function call(path: string, user: { id: string; email: string }, method = 'GET') {
  const token = await createSessionToken(user.id, user.email, e);
  return handleDataRequest(
    new Request(`https://so.test/v1/data/${ART}/${path}`, { method, headers: { Cookie: `shareout_session=${token}` } }),
    e, `${ART}/${path}`);
}

const viewer = { id: 'usr_f27_viewer', email: 'viewer@x.test' };
const owner = { id: 'usr_f27_owner', email: 'f27owner@x.test' };

describe('f27 realtime tier and row-level policy', () => {
  it('blocks: a policy-filtered viewer cannot reach the realtime tier (json is already denied)', async () => {
    expect((await call('json/k', viewer)).status).toBe(403);
    expect((await call('realtime/doc1', viewer)).status).toBe(403);
  });

  it('the owner still reaches the realtime tier', async () => {
    const res = await call('realtime/doc1', owner);
    expect(res.status).toBe(200);
  });
});
