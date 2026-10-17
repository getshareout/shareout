// Home surfaces scoped to a workspace treat only internal members as members: an
// external member (client, guest) gets the same 403 as a non-member.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleHomeForYouApi, handleHomeRecentApi } from '../../../src/pages/home/api';
import { isLinkedWorkspaceMember } from '../../../src/pages/home/filters';

const WS = 'wsp_hx';
const INTERNAL = { id: 'usr_hx_internal', email: 'internal@example.com' };
const EXTERNAL = { id: 'usr_hx_external', email: 'external@example.com' };

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, 'i'), (?, ?, 'x')").bind(INTERNAL.id, INTERNAL.email, EXTERNAL.id, EXTERNAL.email),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'hx-ws', ?)").bind(WS, INTERNAL.id),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_hx_1', ?, ?, 'owner', 'internal'), ('wm_hx_2', ?, ?, 'member', 'external')`).bind(WS, INTERNAL.id, WS, EXTERNAL.id),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES ('art_hx', ?, 'Team page', 'hx-team', 'workspace', ?)").bind(INTERNAL.id, WS),
  ]);
});

const req = (path: string) => new Request(`https://shareout.test${path}`);

describe('home workspace scope and external members', () => {
  it('counts only internal members', async () => {
    expect(await isLinkedWorkspaceMember(e, { userIds: [INTERNAL.id], emails: [] }, WS)).toBe(true);
    expect(await isLinkedWorkspaceMember(e, { userIds: [EXTERNAL.id], emails: [] }, WS)).toBe(false);
  });

  it('refuses workspace-scoped home lists to an external member', async () => {
    for (const handler of [handleHomeForYouApi, handleHomeRecentApi]) {
      expect((await handler(req(`/v1/home/recent?workspace=${WS}`), e, EXTERNAL)).status).toBe(403);
      expect((await handler(req(`/v1/home/recent?workspace=${WS}`), e, INTERNAL)).status).toBe(200);
    }
  });
});
