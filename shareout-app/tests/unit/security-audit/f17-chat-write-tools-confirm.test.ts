// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { ACCOUNT_TOOLS, selectTools } from '../../../src/chat-agent/tools/index';
import { setClientNotesTool } from '../../../src/chat-agent/tools/client-notes';
import { executeAction } from '../../../src/chat-agent/actions';
import { buildClientsContextForWorkspace } from '../../../src/sharees/context';

const WS = 'wsp_f17';
const admin = 'usr_f17_admin';
const member = 'usr_f17_member';
const names = (ts: { name: string }[]) => ts.map((t) => t.name);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email) VALUES (?, 'f17admin@x.test'), (?, 'f17member@x.test')").bind(admin, member),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f17-w', ?)").bind(WS, admin),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f17a', ?, ?, 'owner', 'internal'), ('wm_f17m', ?, ?, 'member', 'internal')").bind(WS, admin, WS, member),
    e.DB.prepare("INSERT INTO sharees (id, workspace_id, name, slug, created_by) VALUES ('Sf17', ?, 'Acme', 'acme', 'usr_f17_admin')").bind(WS),
  ]);
});

describe('f17 unconfirmed chat-agent writes', () => {
  it('blocks: set_client_notes only proposes; nothing is stored until the admin confirms', async () => {
    const out = await setClientNotesTool.execute({ env: e, userId: admin, selectedWorkspaceId: WS }, { client: 'Acme', content: 'INJECTED NOTE' });
    expect(out).toMatchObject({ __propose: { kind: 'client_notes', clientName: 'Acme' } });
    expect(await buildClientsContextForWorkspace(e, WS)).not.toContain('INJECTED NOTE');

    const action = (out as { __propose: Parameters<typeof executeAction>[2] }).__propose;
    expect(await executeAction(e, member, action)).toMatch(/admin/i);
    expect(await buildClientsContextForWorkspace(e, WS)).not.toContain('INJECTED NOTE');

    expect(await executeAction(e, admin, action)).toMatch(/saved/i);
    expect(await buildClientsContextForWorkspace(e, WS)).toContain('INJECTED NOTE');
  });

  it('blocks: a read-only turn exposes no write, proposal or creation tools', () => {
    const readOnly = names(selectTools({ canQueryConnections: false, canSchedule: false, canBuild: false, readOnly: true }));
    for (const t of ['set_client_notes', 'watch_metric', 'present_artifact', 'report_problem', 'edit_page', 'ask_crew', 'share_artifact', 'invite_members', 'set_json_value', 'save_skill']) {
      expect(readOnly, t).not.toContain(t);
    }
    for (const t of ['search_workspace', 'read_artifact', 'find_passages', 'list_artifacts']) expect(readOnly, t).toContain(t);
  });

  it('other surfaces keep the full tool set', () => {
    expect(names(selectTools({ canQueryConnections: false, canSchedule: false, canBuild: false }))).toEqual(names(ACCOUNT_TOOLS));
  });
});
