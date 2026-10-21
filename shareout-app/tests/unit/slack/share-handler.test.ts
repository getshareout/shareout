// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleShareToSlack } from '../../../src/slack/share-handler';
import * as artifacts from '../../../src/artifacts/roles';
import * as wsRoles from '../../../src/workspaces/roles';
import * as slackSend from '../../../src/chat-platforms/slack/delivery';
import * as unfurl from '../../../src/chat-platforms/slack/unfurl';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

const ARTIFACT_ID = 'art_demo';
const USER: AuthUser = { id: 'usr_editor', email: 'e@example.com', username: null };

afterEach(() => vi.restoreAllMocks());
beforeEach(() => { vi.spyOn(wsRoles, 'getInternalWorkspaceRole').mockResolvedValue('member'); });

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('https://shareout.site/v1/artifacts/art_demo/share/slack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeEnv(): Env {
  const first = async () => ({ workspace_id: 'wsp_demo' });
  return { DB: { prepare: () => ({ bind: () => ({ first }) }) } } as unknown as Env;
}

describe('handleShareToSlack', () => {
  it('does not leak raw Slack API errors on delivery failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(artifacts, 'getUserRole').mockResolvedValue('editor');
    vi.spyOn(slackSend, 'sendArtifactToSlack').mockResolvedValue({
      success: false,
      error: 'chat.postMessage failed: channel_not_found: CSECRET123',
    });

    const res = await handleShareToSlack(
      makeRequest({ connection: 'slack', channelId: 'C1' }),
      makeEnv(),
      USER,
      ARTIFACT_ID,
    );
    const body = await res.json() as { error?: string; code?: string };

    expect(res.status).toBe(502);
    expect(body).toMatchObject({ error: 'Failed to deliver to Slack', code: 'SLACK_ERROR' });
    expect(body.error).not.toContain('channel_not_found');
    expect(body.error).not.toContain('CSECRET');
    expect(consoleError).toHaveBeenCalled();
  });

  it('returns SLACK_AUTH without leaking raw Slack error text', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(artifacts, 'getUserRole').mockResolvedValue('editor');
    vi.spyOn(slackSend, 'sendArtifactToSlack').mockResolvedValue({
      success: false,
      error: 'chat.postMessage failed: token_revoked',
    });

    const res = await handleShareToSlack(
      makeRequest({ connection: 'slack', channelId: 'C1' }),
      makeEnv(),
      USER,
      ARTIFACT_ID,
    );
    const body = await res.json() as { error?: string; code?: string };

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      code: 'SLACK_AUTH',
      error: 'Slack connection needs to be re-authorized. Reconnect from workspace settings.',
    });
    expect(body.error).not.toContain('token_revoked');
    expect(consoleError).toHaveBeenCalled();
  });

  it('does not leak internal errors when sendArtifactToSlack throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(artifacts, 'getUserRole').mockResolvedValue('editor');
    vi.spyOn(slackSend, 'sendArtifactToSlack').mockRejectedValue(
      new Error('decrypt failed: invalid key material at offset 42'),
    );

    const res = await handleShareToSlack(
      makeRequest({ connection: 'slack', channelId: 'C1' }),
      makeEnv(),
      USER,
      ARTIFACT_ID,
    );
    const body = await res.json() as { error?: string; code?: string };

    expect(res.status).toBe(502);
    expect(body).toMatchObject({ error: 'Failed to deliver to Slack', code: 'SLACK_ERROR' });
    expect(body.error).not.toContain('decrypt');
    expect(consoleError).toHaveBeenCalled();
  });

  it('returns delivered on success', async () => {
    vi.spyOn(artifacts, 'getUserRole').mockResolvedValue('editor');
    vi.spyOn(slackSend, 'sendArtifactToSlack').mockResolvedValue({ success: true });

    const res = await handleShareToSlack(
      makeRequest({ connection: 'slack', channelId: 'C1' }),
      makeEnv(),
      USER,
      ARTIFACT_ID,
    );
    const body = await res.json() as { delivered?: boolean };

    expect(res.status).toBe(200);
    expect(body).toEqual({ delivered: true });
  });

  it('posts the rich preview card when preview is true', async () => {
    vi.spyOn(artifacts, 'getUserRole').mockResolvedValue('editor');
    const card = [{ type: 'section', text: { type: 'mrkdwn', text: 'TL;DR' } }];
    vi.spyOn(unfurl, 'artifactPreviewBlocksById').mockResolvedValue(card);
    const send = vi.spyOn(slackSend, 'sendArtifactToSlack').mockResolvedValue({ success: true });

    const res = await handleShareToSlack(
      makeRequest({ connection: 'slack', channelId: 'C1', preview: true }),
      makeEnv(),
      USER,
      ARTIFACT_ID,
    );

    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith(expect.anything(), ARTIFACT_ID, expect.objectContaining({ blocks: card }));
  });
});
