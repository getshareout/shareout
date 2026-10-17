// The workspace trash is listed to internal owners/admins only: an external member
// whose row carries an admin role sees only their own deleted pages.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleListDeletedArtifacts } from '../../../src/artifacts/crud';

const WS = 'wsp_trx';
const ADMIN = { id: 'usr_trx_admin', email: 'admin@example.com', username: null };
const EXTERNAL = { id: 'usr_trx_external', email: 'external@example.com', username: null };

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, 'a'), (?, ?, 'x')").bind(ADMIN.id, ADMIN.email, EXTERNAL.id, EXTERNAL.email),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'trx-ws', ?)").bind(WS, ADMIN.id),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_trx_1', ?, ?, 'owner', 'internal'), ('wm_trx_2', ?, ?, 'admin', 'external')`).bind(WS, ADMIN.id, WS, EXTERNAL.id),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id, deleted_at) VALUES ('art_trx', ?, 'Deleted plan', 'trx-plan', 'private', ?, '2026-10-01T00:00:00Z')")
      .bind(ADMIN.id, WS),
  ]);
});

const ids = async (user: typeof ADMIN) => {
  const res = await handleListDeletedArtifacts(new Request('https://shareout.test/v1/artifacts/deleted'), e, user);
  return ((await res.json()) as { artifacts: { id: string }[] }).artifacts.map((a) => a.id);
};

describe('workspace trash listing', () => {
  it('shows workspace deletions to an internal owner, not to an external admin row', async () => {
    expect(await ids(ADMIN)).toContain('art_trx');
    expect(await ids(EXTERNAL)).not.toContain('art_trx');
  });
});
