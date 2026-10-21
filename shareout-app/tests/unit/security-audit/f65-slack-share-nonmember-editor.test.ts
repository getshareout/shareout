// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleShareToSlack } from '../../../src/slack/share-handler';
import * as roles from '../../../src/artifacts/roles';
import * as wsRoles from '../../../src/workspaces/roles';
import * as slackSend from '../../../src/chat-platforms/slack/delivery';
import type { Env } from '../../../src/types';

afterEach(() => vi.restoreAllMocks());

const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ workspace_id: 'wsp_f65' }) }) }) } } as unknown as Env;
const req = () => new Request('https://so.test/v1/artifacts/art_f65/share/slack', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ connection: 'slack', channelId: 'C1', message: 'hi' }),
});
const user = { id: 'usr_f65', email: 'f65@example.test', username: null };

describe('f65 slack share by non-member editor', () => {
  it('blocks: editor outside the workspace cannot post with the workspace bot token', async () => {
    vi.spyOn(roles, 'getUserRole').mockResolvedValue('editor');
    vi.spyOn(wsRoles, 'getInternalWorkspaceRole').mockResolvedValue(null);
    const send = vi.spyOn(slackSend, 'sendArtifactToSlack').mockResolvedValue({ success: true });
    const res = await handleShareToSlack(req(), env, user, 'art_f65');
    expect(res.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('a workspace-member editor can still post', async () => {
    vi.spyOn(roles, 'getUserRole').mockResolvedValue('editor');
    vi.spyOn(wsRoles, 'getInternalWorkspaceRole').mockResolvedValue('member');
    const send = vi.spyOn(slackSend, 'sendArtifactToSlack').mockResolvedValue({ success: true });
    const res = await handleShareToSlack(req(), env, user, 'art_f65');
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalled();
  });
});
