import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../../src/types';

const h = vi.hoisted(() => ({
  postSlackMessage: vi.fn(),
  slackPost: vi.fn(),
}));

vi.mock('../../../../src/chat-platforms/slack/linking', () => ({
  getSlackLink: async () => ({ connection_name: 'slack', selected_workspace_id: 'wsp_1' }),
}));
vi.mock('../../../../src/chat-platforms/slack/client', () => ({
  resolveSlackToken: async () => ({ token: 'xoxb-1' }),
  openDmChannel: async () => ({ channelId: 'D1' }),
  postSlackMessage: h.postSlackMessage,
  slackPost: h.slackPost,
  uploadFileToSlack: vi.fn(),
}));

import { createSlackReplyPort } from '../../../../src/chat-platforms/slack/reply-port';

const port = () => createSlackReplyPort({} as Env, { teamId: 'T1', slackUserId: 'U1', channelId: 'D1' });

describe('createSlackReplyPort streaming', () => {
  it('posts a placeholder and settles it with chat.update', async () => {
    h.postSlackMessage.mockResolvedValue({ ok: true, ts: '171.1' });
    h.slackPost.mockResolvedValue({ ok: true });
    const p = port();
    await p.sendTextDelta!('Looking');
    expect(h.postSlackMessage).toHaveBeenCalledWith('xoxb-1', 'D1', 'Looking');
    await p.finishText!('*Found it*');
    expect(h.slackPost).toHaveBeenCalledWith('xoxb-1', 'chat.update', { channel: 'D1', ts: '171.1', text: '*Found it*' });
    expect(h.postSlackMessage).toHaveBeenCalledTimes(1);
  });

  it('posts the final text once when chat.update fails', async () => {
    h.postSlackMessage.mockReset().mockResolvedValue({ ok: true, ts: '171.2' });
    h.slackPost.mockReset().mockResolvedValue({ ok: false, error: 'cant_update_message' });
    const p = port();
    await p.sendTextDelta!('Looking');
    await p.finishText!('Answer');
    expect(h.postSlackMessage).toHaveBeenCalledTimes(2);
    expect(h.postSlackMessage).toHaveBeenLastCalledWith('xoxb-1', 'D1', 'Answer');
  });
});
