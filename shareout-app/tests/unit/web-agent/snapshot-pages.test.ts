// The assistant snapshot's page list comes from a slim query (id + name) that must apply
// exactly the home catalog's visibility rules, in the catalog's order, on the real schema:
// never a page the user can't open — not another member's private page, a deleted page,
// the asset bucket, another workspace's page, or anything at all for an outsider.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';
import { queryHomeArtifactCatalog, queryHomeArtifactNames } from '../../../src/pages/home/queries/artifacts';
import { buildWorkspaceSnapshot } from '../../../src/router/api/workspace-agent';
import { buildHomeSnapshot } from '../../../src/router/api/home-agent';

const WS = 'wsp_sp';
const WS_OTHER = 'wsp_sp_other';
const WS_BIG = 'wsp_sp_big';

const who = (id: string, email: string): AuthUser => ({ id, email, username: null });
const ALICE = who('usr_sp_alice', 'alice@example.com');
const ALICE_ALT = who('usr_sp_alice_alt', 'alice.alt@example.com'); // linked to Alice
const BOB = who('usr_sp_bob', 'bob@example.com');
const EVE = who('usr_sp_eve', 'eve@example.com'); // external member of WS
const MALLORY = who('usr_sp_mallory', 'mallory@example.com'); // member of another workspace only
const CARL = who('usr_sp_carl', 'carl@example.com'); // linked to a disabled member account

const BIG = Array.from({ length: 17 }, (_, i) => `art_sp_big_${String(i + 1).padStart(2, '0')}`);

beforeAll(async () => {
  await applyMigrations();
  const art = (id: string, owner: string, name: string, visibility: string, ws: string | null, createdAt: string, deletedAt: string | null = null) =>
    e.DB.prepare('INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, owner, name, id.replace(/_/g, '-'), visibility, ws, createdAt, deletedAt);
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO users (id, email, name, identity_id, disabled) VALUES
      ('usr_sp_alice', 'alice@example.com', 'a', 'idn_sp_a', 0), ('usr_sp_alice_alt', 'alice.alt@example.com', 'a2', 'idn_sp_a', 0),
      ('usr_sp_bob', 'bob@example.com', 'b', NULL, 0), ('usr_sp_eve', 'eve@example.com', 'e', NULL, 0),
      ('usr_sp_mallory', 'mallory@example.com', 'm', NULL, 0),
      ('usr_sp_carl', 'carl@example.com', 'c', 'idn_sp_c', 0), ('usr_sp_carl_off', 'carl.off@example.com', 'c2', 'idn_sp_c', 1)`),
    e.DB.prepare(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES
      (?, 'SP', 'sp-ws', 'usr_sp_bob'), (?, 'SP other', 'sp-other', 'usr_sp_mallory'), (?, 'SP big', 'sp-big', 'usr_sp_alice')`).bind(WS, WS_OTHER, WS_BIG),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_sp_1', ?1, 'usr_sp_alice', 'member', 'internal'), ('wm_sp_2', ?1, 'usr_sp_bob', 'owner', 'internal'),
      ('wm_sp_3', ?1, 'usr_sp_eve', 'member', 'external'), ('wm_sp_4', ?1, 'usr_sp_carl_off', 'admin', 'internal'),
      ('wm_sp_5', ?2, 'usr_sp_mallory', 'owner', 'internal'), ('wm_sp_6', ?3, 'usr_sp_alice', 'owner', 'internal')`).bind(WS, WS_OTHER, WS_BIG),
    art('art_sp_team', BOB.id, 'SP team plan', 'workspace', WS, '2026-01-01T00:00:00.000Z'),
    art('art_sp_bob_private', BOB.id, 'SP bob private', 'private', WS, '2026-01-02T00:00:00.000Z'),
    art('art_sp_shared', BOB.id, 'SP shared with alice', 'private', WS, '2026-01-03T00:00:00.000Z'),
    art('art_sp_alice_private', ALICE.id, 'SP alice private', 'private', WS, '2026-01-04T00:00:00.000Z'),
    art('art_sp_deleted', BOB.id, 'SP deleted', 'workspace', WS, '2026-01-05T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
    art('art_sp_bucket', BOB.id, 'SP bucket', 'workspace', WS, '2026-01-06T00:00:00.000Z'),
    art('art_sp_public', BOB.id, 'SP public', 'public', WS, '2026-01-07T00:00:00.000Z'),
    art('art_sp_other', MALLORY.id, 'SP other workspace', 'workspace', WS_OTHER, '2026-01-08T00:00:00.000Z'),
    art('art_sp_alice_personal', ALICE.id, 'SP alice personal', 'private', null, '2026-01-09T00:00:00.000Z'),
    art('art_sp_bob_personal', BOB.id, 'SP bob personal shared', 'private', null, '2026-01-10T00:00:00.000Z'),
    art('art_sp_bob_secret', BOB.id, 'SP bob secret', 'private', null, '2026-01-11T00:00:00.000Z'),
    art('art_sp_bob_public', BOB.id, 'SP bob public', 'public', null, '2026-01-12T00:00:00.000Z'),
    ...BIG.map((id, i) => art(id, ALICE.id, `SP big ${i + 1}`, 'workspace', WS_BIG, `2026-04-01T00:00:${String(i).padStart(2, '0')}.000Z`)),
    // Shared with Alice directly, and with her linked account's address.
    e.DB.prepare(`INSERT INTO collaborators (id, artifact_id, email, role) VALUES
      ('col_sp_1', 'art_sp_shared', 'alice@example.com', 'viewer'), ('col_sp_2', 'art_sp_bob_personal', 'alice.alt@example.com', 'editor')`),
    e.DB.prepare("INSERT INTO asset_buckets (artifact_id, workspace_id, owner_id) VALUES ('art_sp_bucket', ?, 'usr_sp_bob')").bind(WS),
    // The oldest page was republished last, so it sorts first (production deploy time wins).
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint) VALUES ('ver_sp_team', 'art_sp_team', 1, 'index.html')"),
    e.DB.prepare(`INSERT INTO deployments (id, artifact_id, version_id, channel, slug, updated_at)
      VALUES ('dep_sp_team', 'art_sp_team', 'ver_sp_team', 'production', 'art-sp-team', '2026-03-01T00:00:00.000Z')`),
    e.DB.prepare(`INSERT INTO artifact_comments (id, artifact_id, author_id, author_name, content, assignee_user_id, due_at)
      VALUES ('cmt_sp_1', 'art_sp_team', 'usr_sp_bob', 'Bob', 'Check the Q3 numbers', 'usr_sp_alice', '2099-12-01T00:00:00.000Z')`),
  ]);
});

const names = async (user: AuthUser, ws: string | null) =>
  (await queryHomeArtifactNames(e, user, ws, 15)).artifacts.map((a) => a.id);
const listed = (snapshot: string) => [...snapshot.matchAll(/\(id: (art_\w+)\)/g)].map((m) => m[1]);

const CASES: Array<[string, AuthUser, string | null, string[]]> = [
  ['a member', ALICE, WS, ['art_sp_team', 'art_sp_public', 'art_sp_alice_private', 'art_sp_shared']],
  ['a member through a linked account', ALICE_ALT, WS, ['art_sp_team', 'art_sp_public', 'art_sp_alice_private', 'art_sp_shared']],
  ['the owner', BOB, WS, ['art_sp_team', 'art_sp_public', 'art_sp_shared', 'art_sp_bob_private']],
  ['an external member', EVE, WS, []],
  ['a member of another workspace', MALLORY, WS, []],
  ['an account linked to a disabled member', CARL, WS, []],
  ['a member, outside their workspace', ALICE, WS_OTHER, []],
  ['a personal home', ALICE, null, ['art_sp_bob_personal', 'art_sp_alice_personal']],
  ['a personal home with nothing of their own', MALLORY, null, []],
];

describe('snapshot page list visibility', () => {
  it.each(CASES)('%s sees exactly the pages they can open', async (_label, user, ws, expected) => {
    expect(await names(user, ws)).toEqual(expected);
  });

  it.each(CASES)('%s: same pages and order as the home catalog', async (_label, user, ws) => {
    const catalog = await queryHomeArtifactCatalog(e, { id: user.id, email: user.email }, ws);
    expect(await names(user, ws)).toEqual(catalog.artifacts.slice(0, 15).map((a) => a.id));
  });

  it('the workspace snapshot lists only what the user can open', async () => {
    expect(listed(await buildWorkspaceSnapshot(e, WS, ALICE))).toEqual(['art_sp_team', 'art_sp_public', 'art_sp_alice_private', 'art_sp_shared']);
    for (const outsider of [EVE, MALLORY, CARL]) {
      const snap = await buildWorkspaceSnapshot(e, WS, outsider);
      expect(listed(snap)).toEqual([]);
      expect(snap).toContain('Pages (0 shown):\n(none yet)');
    }
  });

  it('the home snapshot lists only what the user can open, here or at home', async () => {
    expect(listed(await buildHomeSnapshot(e, WS, BOB))).toEqual(['art_sp_team', 'art_sp_public', 'art_sp_shared', 'art_sp_bob_private']);
    expect(listed(await buildHomeSnapshot(e, WS, EVE))).toEqual([]);
    expect(listed(await buildHomeSnapshot(e, null, ALICE))).toEqual(['art_sp_bob_personal', 'art_sp_alice_personal']);
  });

  it('the home snapshot still carries the user\'s open action items', async () => {
    const snap = await buildHomeSnapshot(e, WS, ALICE);
    expect(snap).toContain('Action items (1 open):\n- Check the Q3 numbers on "SP team plan" (due 2099-12-01)');
    expect(await buildHomeSnapshot(e, WS, BOB)).not.toContain('Action items');
  });
});

describe('snapshot page list shape', () => {
  it('returns id and name only: `limit` rows, and whether more exist', async () => {
    const page = await queryHomeArtifactNames(e, ALICE, WS_BIG, 15);
    expect(page.truncated).toBe(true);
    expect(page.artifacts).toHaveLength(15);
    for (const row of page.artifacts) expect(Object.keys(row).sort()).toEqual(['id', 'name']);
    expect(page.artifacts[0]).toEqual({ id: 'art_sp_big_17', name: 'SP big 17' });

    const all = await queryHomeArtifactNames(e, ALICE, WS_BIG, 17);
    expect(all.truncated).toBe(false);
    expect(all.artifacts.map((a) => a.id)).toEqual([...BIG].reverse());
  });

  it('reads in two statements (linked accounts, then one select) where the catalog needs three', async () => {
    const sql: string[] = [];
    const env = { ...e, DB: { prepare: (q: string) => { sql.push(q); return e.DB.prepare(q); } } } as unknown as Env;
    await queryHomeArtifactNames(env, ALICE, WS, 15);
    expect(sql).toHaveLength(2);
    expect(sql[1]).toMatch(/SELECT a\.id, a\.name\s+FROM artifacts a/);
    sql.length = 0;
    await queryHomeArtifactCatalog(env, ALICE, WS);
    expect(sql).toHaveLength(3);
  });

  it('the snapshot lists 15 pages and marks that there are more', async () => {
    const lines = (await buildWorkspaceSnapshot(e, WS_BIG, ALICE)).split('\n');
    expect(lines[0]).toBe('Pages (15 shown+):');
    expect(lines.slice(1, 16).every((l) => l.startsWith('- SP big '))).toBe(true);
    expect(lines[16]).toBe('');
  });
});
