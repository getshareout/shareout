import { beforeAll, describe, expect, it } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const WS = 'ws_f34';
const PRIV = 'art_f34_priv';
const PUB = 'art_f34_pub';
const owner = { id: 'usr_f34_owner', email: 'f34owner@x.test' };
const member = { id: 'usr_f34_member', email: 'f34member@x.test' };
const outsider = { id: 'usr_f34_out', email: 'f34out@x.test' };

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-f34';
  const art = (id: string, vis: string) =>
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, id, `slug-${id}`, owner.id, vis, WS);
  await e.DB.batch([
    ...[owner, member, outsider].map((u) => e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(u.id, u.email)),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'w-f34', ?)").bind(WS, owner.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f34a', ?, ?, 'owner', 'internal'), ('wm_f34b', ?, ?, 'member', 'internal'), ('wm_f34c', ?, ?, 'member', 'external')")
      .bind(WS, owner.id, WS, member.id, WS, outsider.id),
    art(PRIV, 'private'),
    art(PUB, 'public'),
    e.DB.prepare("INSERT INTO workspace_shared_tables (id, workspace_id, shared_name, owner_artifact_id, source_table_name, access) VALUES ('wst_f34', ?, 'leads', ?, 'leads', 'readwrite')").bind(WS, PRIV),
  ]);
  await e.DB.batch([
    e.DB.prepare('INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, ?)').bind('ver_f34', PUB, 'index.html', '{}'),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_f34', ?, 'ver_f34', 'production', ?)").bind(PUB, `slug-${PUB}`),
  ]);
});

async function viaPublic(path: string, method = 'GET', user?: { id: string; email: string }, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) headers.Cookie = `shareout_session=${await createSessionToken(user.id, user.email, e)}`;
  return handleDataRequest(
    new Request(`https://so.test/v1/data/${PUB}/workspace/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    e, `${PUB}/workspace/${path}`);
}

describe('f34 workspace shared tables', () => {
  it('blocks: anonymous and external visitors of a public sibling cannot read or write shared tables', async () => {
    expect([401, 403]).toContain((await viaPublic('tables/leads/query', 'POST', undefined, {})).status);
    expect([401, 403]).toContain((await viaPublic('tables/leads', 'POST', undefined, { name: 'x' })).status);
    expect([401, 403]).toContain((await viaPublic('tables/leads/query', 'POST', outsider, {})).status);
    expect([401, 403]).toContain((await viaPublic('_shares')).status);
  });

  it('internal members still read and write', async () => {
    expect((await viaPublic('tables/leads/query', 'POST', member, {})).status).toBe(200);
    expect((await viaPublic('_shares', 'GET', member)).status).toBe(200);
  });
});
