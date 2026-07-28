// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleListSlackChannels } from '../../../src/router/api/workspace-connections';
import * as slackSend from '../../../src/slack/send';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

const WORKSPACE_ID = 'wsp_team';
const USER: AuthUser = { id: 'usr_member', email: 'm@example.com', username: null };

afterEach(() => vi.restoreAllMocks());

function makeEnv(role: string | null): Env {
  const prepare = vi.fn((sql: string) => ({
    bind: () => ({
      first: vi.fn(async () => {
        if (sql.includes('FROM workspace_members')) {
          return role === null ? null : { role };
        }
        return null;
      }),
    }),
  }));
  return { DB: { prepare } } as unknown as Env;
}

describe('handleListSlackChannels', () => {
  it('rejects non-members', async () => {
    const env = makeEnv(null);
    const res = await handleListSlackChannels(env, USER, WORKSPACE_ID, 'slack');
    expect(res.status).toBe(403);
  });

  it('does not leak internal errors when listSlackChannels throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(slackSend, 'resolveSlackToken').mockResolvedValue({ token: 'xoxb-secret' });
    vi.spyOn(slackSend, 'listSlackChannels').mockRejectedValue(
      new Error('conversations.list failed: internal_error: D1 timeout at shard 7'),
    );

    const env = makeEnv('member');
    const res = await handleListSlackChannels(env, USER, WORKSPACE_ID, 'slack');
    const body = await res.json() as { error?: string; code?: string };

    expect(res.status).toBe(502);
    expect(body).toMatchObject({ error: 'Failed to list Slack channels', code: 'SLACK_ERROR' });
    expect(body.error).not.toContain('D1');
    expect(body.error).not.toContain('xoxb');
    expect(consoleError).toHaveBeenCalled();
  });

  it('returns SLACK_AUTH without leaking raw Slack error text', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(slackSend, 'resolveSlackToken').mockResolvedValue({ token: 'xoxb-revoked' });
    vi.spyOn(slackSend, 'listSlackChannels').mockRejectedValue(
      new Error('conversations.list failed: token_revoked'),
    );

    const env = makeEnv('member');
    const res = await handleListSlackChannels(env, USER, WORKSPACE_ID, 'slack');
    const body = await res.json() as { error?: string; code?: string };

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      code: 'SLACK_AUTH',
      error: 'Slack connection needs to be re-authorized. Reconnect from workspace settings.',
    });
    expect(body.error).not.toContain('token_revoked');
    expect(body.error).not.toContain('xoxb');
    expect(consoleError).toHaveBeenCalled();
  });

  it('returns channels on success', async () => {
    vi.spyOn(slackSend, 'resolveSlackToken').mockResolvedValue({ token: 'xoxb-ok' });
    vi.spyOn(slackSend, 'listSlackChannels').mockResolvedValue([{ id: 'C1', name: 'general' }]);

    const env = makeEnv('member');
    const res = await handleListSlackChannels(env, USER, WORKSPACE_ID, 'slack');
    const body = await res.json() as { channels?: Array<{ id: string; name: string }> };

    expect(res.status).toBe(200);
    expect(body.channels).toEqual([{ id: 'C1', name: 'general' }]);
  });
});
