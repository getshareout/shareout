// A viewer collaborator (for example an outside client) may DM only their own linked
// Slack account, and sees the workspace's Slack channel list only as an internal member.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleShareToSlack } from '../../../src/slack/share-handler';
import { handleDeliverSlackChannels } from '../../../src/router/api/artifact-deliver';
import * as slackSend from '../../../src/chat-platforms/slack/delivery';
import type { AuthUser } from '../../../src/api-auth';

const WS = 'wsp_svl';
const ART = 'art_svl';
const OWNER: AuthUser = { id: 'usr_svl_owner', email: 'owner@example.com', username: null };
const CLIENT: AuthUser = { id: 'usr_svl_client', email: 'client@example.com', username: null };
const TEAMMATE: AuthUser = { id: 'usr_svl_teammate', email: 'teammate@example.com', username: null };

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, 'o'), (?, ?, 'c'), (?, ?, 't')")
      .bind(OWNER.id, OWNER.email, CLIENT.id, CLIENT.email, TEAMMATE.id, TEAMMATE.email),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'svl-ws', ?)").bind(WS, OWNER.id),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_svl_1', ?, ?, 'owner', 'internal'), ('wm_svl_2', ?, ?, 'member', 'internal')`).bind(WS, OWNER.id, WS, TEAMMATE.id),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES (?, ?, 'Report', 'svl-report', 'private', ?)").bind(ART, OWNER.id, WS),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_svl_1', ?, ?, 'viewer'), ('col_svl_2', ?, ?, 'viewer')")
      .bind(ART, CLIENT.email, ART, TEAMMATE.email),
    e.DB.prepare("INSERT INTO messaging_links (platform, session_key, user_id, platform_user_id, team_id, linked_at) VALUES ('slack', 'T1:U_CLIENT', ?, 'U_CLIENT', 'T1', '2026-01-01T00:00:00Z')")
      .bind(CLIENT.id),
  ]);
});

const share = (body: Record<string, unknown>) => new Request(`https://shareout.test/v1/artifacts/${ART}/share/slack`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('viewer Slack limits', () => {
  it('refuses a viewer DM to someone else and allows one to their own linked account', async () => {
    const send = vi.spyOn(slackSend, 'sendArtifactToSlack').mockResolvedValue({ success: true } as Awaited<ReturnType<typeof slackSend.sendArtifactToSlack>>);
    const other = await handleShareToSlack(share({ connection: 'slack', targetType: 'dm', slackUserId: 'U_SOMEONE' }), e, CLIENT, ART);
    expect(other.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
    await handleShareToSlack(share({ connection: 'slack', targetType: 'dm', slackUserId: 'U_CLIENT' }), e, CLIENT, ART);
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRestore();
  });

  it('lists workspace Slack channels to an internal viewer but not an outside one', async () => {
    const req = new Request(`https://shareout.test/v1/artifacts/${ART}/deliver/slack-channels`);
    expect((await handleDeliverSlackChannels(req, e, CLIENT, ART)).status).toBe(403);
    expect((await handleDeliverSlackChannels(req, e, TEAMMATE, ART)).status).toBe(200);
  });
});
