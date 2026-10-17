// Workspace roles grant alert/present/watch access to workspace-visible artifacts,
// never to a member's private artifact.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { resolveAlertRole } from '../../../src/metric-alerts/access';

const WS = 'wsp_arv';
const ref = (id: string) => ({ id, workspace_id: WS });

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO users (id, email, name) VALUES ('usr_arv_owner', 'o@example.com', 'o'),
      ('usr_arv_admin', 'ad@example.com', 'ad'), ('usr_arv_member', 'm@example.com', 'm'), ('usr_arv_collab', 'c@example.com', 'c')`),
    e.DB.prepare(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'arv', 'usr_arv_admin')`).bind(WS),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_arv_1', ?, 'usr_arv_owner', 'member', 'internal'), ('wm_arv_2', ?, 'usr_arv_admin', 'admin', 'internal'),
      ('wm_arv_3', ?, 'usr_arv_member', 'member', 'internal')`).bind(WS, WS, WS),
    e.DB.prepare(`INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES
      ('art_arv_priv', 'usr_arv_owner', 'P', 'arv-priv', 'private', ?), ('art_arv_ws', 'usr_arv_owner', 'W', 'arv-ws', 'workspace', ?)`).bind(WS, WS),
    e.DB.prepare(`INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_arv', 'art_arv_priv', 'c@example.com', 'viewer')`),
  ]);
});

describe('resolveAlertRole', () => {
  it('keeps workspace roles on workspace-visible artifacts', async () => {
    expect(await resolveAlertRole(e, ref('art_arv_ws'), 'usr_arv_admin')).toBe('manager');
    expect(await resolveAlertRole(e, ref('art_arv_ws'), 'usr_arv_member')).toBe('viewer');
  });

  it('does not extend workspace roles to a private artifact', async () => {
    expect(await resolveAlertRole(e, ref('art_arv_priv'), 'usr_arv_admin')).toBeNull();
    expect(await resolveAlertRole(e, ref('art_arv_priv'), 'usr_arv_member')).toBeNull();
    expect(await resolveAlertRole(e, ref('art_arv_priv'), 'usr_arv_owner')).toBe('manager');
    expect(await resolveAlertRole(e, ref('art_arv_priv'), 'usr_arv_collab')).toBe('viewer');
  });
});
