// Bot account links against the real schema: a disabled account's link stops resolving,
// and Slack linking only goes through connections of workspaces the user is an internal member of.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ resolveSlackToken: vi.fn(), resolveSlackMemberId: vi.fn() }));
vi.mock('../../../src/chat-platforms/slack/client', async (orig) => ({
  ...(await orig<object>()),
  resolveSlackToken: h.resolveSlackToken,
  resolveSlackMemberId: h.resolveSlackMemberId,
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import { getLinkedUserId as telegramLinkedUser, linkChat } from '../../../src/telegram/linking';
import { getLinkedUserId as slackLinkedUser, getSlackLink, linkSlackDm, listSlackConnectionsForUser } from '../../../src/chat-platforms/slack/linking';
import { linkSlackAccount } from '../../../src/pages/slack-connect';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO users (id, email, name, disabled) VALUES
      ('usr_lk_on', 'on@example.com', 'on', 0), ('usr_lk_off', 'off@example.com', 'off', 1),
      ('usr_lk_out', 'out@example.com', 'out', 0), ('usr_lk_ext', 'ext@example.com', 'ext', 0)`),
    e.DB.prepare(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('wsp_lk_a', 'A', 'lk-a', 'usr_lk_on')`),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_lk_1', 'wsp_lk_a', 'usr_lk_on', 'owner', 'internal'), ('wm_lk_2', 'wsp_lk_a', 'usr_lk_ext', 'member', 'external')`),
    e.DB.prepare(`INSERT INTO connections (id, scope_type, scope_id, name, provider, kind) VALUES ('conn_lk_slack', 'workspace', 'wsp_lk_a', 'slack', 'slack', 'platform')`),
  ]);
});

describe('linked bot accounts', () => {
  it('does not resolve a disabled user from a Telegram link', async () => {
    await linkChat(e, 9001, 'usr_lk_on');
    await linkChat(e, 9002, 'usr_lk_off');
    expect(await telegramLinkedUser(e, 9001)).toBe('usr_lk_on');
    expect(await telegramLinkedUser(e, 9002)).toBeNull();
  });

  it('does not resolve a disabled user from a Slack link', async () => {
    await linkSlackDm(e, { userId: 'usr_lk_on', teamId: 'T1', slackUserId: 'U1', connectionName: 'slack', workspaceId: 'wsp_lk_a' });
    await linkSlackDm(e, { userId: 'usr_lk_off', teamId: 'T1', slackUserId: 'U2', connectionName: 'slack', workspaceId: 'wsp_lk_a' });
    expect(await slackLinkedUser(e, 'T1', 'U1')).toBe('usr_lk_on');
    expect(await slackLinkedUser(e, 'T1', 'U2')).toBeNull();
    expect(await getSlackLink(e, 'T1', 'U2')).toBeNull();
  });
});

describe('Slack account linking', () => {
  it('offers connections only to internal members', async () => {
    expect((await listSlackConnectionsForUser(e, 'usr_lk_on')).map((c) => c.workspaceId)).toEqual(['wsp_lk_a']);
    expect(await listSlackConnectionsForUser(e, 'usr_lk_ext')).toEqual([]);
    expect(await listSlackConnectionsForUser(e, 'usr_lk_out')).toEqual([]);
  });

  it('refuses another workspace connection before using it', async () => {
    h.resolveSlackToken.mockResolvedValue({ token: 'xoxb', teamId: 'T9' });
    h.resolveSlackMemberId.mockResolvedValue({ userId: 'U9' });
    for (const user of [{ id: 'usr_lk_out', email: 'out@example.com' }, { id: 'usr_lk_ext', email: 'ext@example.com' }]) {
      const res = await linkSlackAccount(e, user, 'wsp_lk_a::slack');
      expect(res.ok).toBe(false);
    }
    expect(h.resolveSlackToken).not.toHaveBeenCalled();
    expect(await slackLinkedUser(e, 'T9', 'U9')).toBeNull();

    expect(await linkSlackAccount(e, { id: 'usr_lk_on', email: 'on@example.com' }, 'wsp_lk_a::slack')).toEqual({ ok: true });
    expect(await slackLinkedUser(e, 'T9', 'U9')).toBe('usr_lk_on');
  });
});
