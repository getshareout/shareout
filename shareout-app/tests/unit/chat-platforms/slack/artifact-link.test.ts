// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

const postSlackMessage = vi.fn();
const uploadFileToSlack = vi.fn();
const renderArtifactImage = vi.fn();

// resolveSlackTokenForArtifact lives in delivery.ts and delegates to this client
// export, so the token mock has to sit on resolveSlackToken.
vi.mock('../../../../src/chat-platforms/slack/client', () => ({
  postSlackMessage: (...a: unknown[]) => postSlackMessage(...a),
  uploadFileToSlack: (...a: unknown[]) => uploadFileToSlack(...a),
  resolveSlackToken: async () => ({ token: 'xoxb-test' }),
  resolveSlackMemberId: async () => ({ userId: 'U1' }),
  openDmChannel: async () => ({ channelId: 'D1' }),
  buildArtifactUrl: () => 'https://shareout.site/a/daily-briefing/',
}));
vi.mock('../../../../src/screenshots', () => ({
  renderArtifactImage: (...a: unknown[]) => renderArtifactImage(...a),
  renderArtifactPdf: async () => new Uint8Array([1]),
}));

import { sendArtifactToSlack } from '../../../../src/chat-platforms/slack/delivery';

// One row shape serves both lookups: the workspace probe and the artifact metadata.
const env = {
  DB: {
    prepare: () => ({
      bind: () => ({
        first: async () => ({
          workspace_id: 'wsp_1',
          name: 'Daily Briefing',
          slug: 'daily-briefing',
          display_slug: null,
          workspace_slug: 'acme',
          subdomain_enabled: 0,
        }),
      }),
    }),
  },
} as never;

const base = { connection: 'team', channelId: 'C1', message: 'briefing text' };

beforeEach(() => {
  postSlackMessage.mockReset().mockResolvedValue({ ok: true });
  uploadFileToSlack.mockReset().mockResolvedValue({ ok: true });
  renderArtifactImage.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
});

const blocksOf = () => postSlackMessage.mock.calls[0][3] as Record<string, unknown>[];
const hasShareOutButton = () =>
  JSON.stringify(blocksOf()).includes('Open in ShareOut');

describe('sendArtifactToSlack — includeArtifactLink', () => {
  it('includes the ShareOut button by default', async () => {
    await sendArtifactToSlack(env, 'art_1', { ...base, mode: 'message' });
    expect(hasShareOutButton()).toBe(true);
  });

  it('omits the button when includeArtifactLink is false', async () => {
    await sendArtifactToSlack(env, 'art_1', { ...base, mode: 'message', includeArtifactLink: false });
    expect(hasShareOutButton()).toBe(false);
    // The narrative itself must survive untouched.
    expect(JSON.stringify(blocksOf())).toContain('briefing text');
  });

  it('omits the button in "both" mode but still uploads the snapshot', async () => {
    await sendArtifactToSlack(env, 'art_1', { ...base, mode: 'both', includeArtifactLink: false });
    expect(hasShareOutButton()).toBe(false);
    expect(uploadFileToSlack).toHaveBeenCalledTimes(1);
  });

  it('keeps the button in "both" mode by default', async () => {
    await sendArtifactToSlack(env, 'art_1', { ...base, mode: 'both' });
    expect(hasShareOutButton()).toBe(true);
  });

  it('drops the URL from the snapshot comment when the link is suppressed', async () => {
    await sendArtifactToSlack(env, 'art_1', { ...base, mode: 'snapshot', includeArtifactLink: false });
    const comment = uploadFileToSlack.mock.calls[0][6] as string;
    expect(comment).toBe('briefing text');
    expect(comment).not.toContain('shareout.site');
  });

  it('keeps the URL in the snapshot comment by default', async () => {
    await sendArtifactToSlack(env, 'art_1', { ...base, mode: 'snapshot' });
    expect(uploadFileToSlack.mock.calls[0][6] as string).toContain('shareout.site');
  });
});
