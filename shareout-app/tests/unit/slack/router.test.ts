import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { createFetchContext } from '../../../src/router/context';
import { routeSlack } from '../../../src/router/slack-router';

const getLinkedUserId = vi.hoisted(() => vi.fn(async () => null as string | null));
const sendText = vi.hoisted(() => vi.fn());
const unlinkSlackDm = vi.hoisted(() => vi.fn());
const setSelectedSlackWorkspace = vi.hoisted(() => vi.fn());
const getSelectedSlackWorkspace = vi.hoisted(() => vi.fn(async () => null));

vi.mock('../../../src/chat-platforms/slack/linking', () => ({
  getLinkedUserId,
  getSelectedSlackWorkspace,
  setSelectedSlackWorkspace,
  unlinkSlackDm,
}));

vi.mock('../../../src/chat-platforms/slack/reply-port', () => ({
  createSlackReplyPort: vi.fn(() => ({
    sendText,
    sendTyping: vi.fn(),
    sendImage: vi.fn(),
    sendFile: vi.fn(),
    sendArtifactCards: vi.fn(),
    askConfirmation: vi.fn(),
  })),
}));

vi.mock('../../../src/support/intake', () => ({
  openTicket: vi.fn().mockResolvedValue({ id: 't1' }),
}));

async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${timestamp}:${body}`));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `v0=${hex}`;
}

const ENV = {
  SLACK_SIGNING_SECRET: 'sek',
  SHAREOUT_BASE_URL: 'https://shareout.site',
} as Env;

async function signedPost(path: string, body: string, contentType = 'application/json') {
  const ts = String(Math.floor(Date.now() / 1000));
  const request = new Request(`https://shareout.site${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'X-Slack-Request-Timestamp': ts,
      'X-Slack-Signature': await sign('sek', ts, body),
    },
    body,
  });
  return routeSlack(createFetchContext(request, ENV));
}

beforeEach(() => {
  getLinkedUserId.mockReset().mockResolvedValue(null);
  sendText.mockReset();
  unlinkSlackDm.mockReset();
  setSelectedSlackWorkspace.mockReset();
  getSelectedSlackWorkspace.mockReset().mockResolvedValue(null);
});

describe('routeSlack events', () => {
  it('answers url_verification challenges', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
    const res = await signedPost('/slack/events', body);
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({ challenge: 'abc123' });
  });

  it('returns 200 for invalid signatures without throwing', async () => {
    const request = new Request('https://shareout.site/slack/events', {
      method: 'POST',
      headers: { 'X-Slack-Signature': 'v0=bad' },
      body: '{}',
    });
    const res = await routeSlack(createFetchContext(request, ENV));
    expect(res?.status).toBe(200);
  });

  it('ignores non-slack paths', async () => {
    expect(await routeSlack(createFetchContext(new Request('https://shareout.site/other'), ENV))).toBeNull();
  });
});

describe('routeSlack slash commands', () => {
  it('sends help without requiring a linked account', async () => {
    const form = new URLSearchParams({
      team_id: 'T1',
      user_id: 'U1',
      channel_id: 'D1',
      text: 'help',
      trigger_id: 'trig1',
    }).toString();
    const res = await signedPost('/slack/commands', form, 'application/x-www-form-urlencoded');
    expect(res?.status).toBe(200);
    expect(sendText).toHaveBeenCalledWith(expect.stringContaining('ShareOut assistant'));
  });

  it('prompts unlinked users on free-text (status)', async () => {
    const form = new URLSearchParams({
      team_id: 'T1',
      user_id: 'U1',
      channel_id: 'D1',
      text: 'status',
      trigger_id: 'trig2',
    }).toString();
    const res = await signedPost('/slack/commands', form, 'application/x-www-form-urlencoded');
    expect(res?.status).toBe(200);
    expect(sendText).toHaveBeenCalledWith(expect.stringMatching(/Connect your ShareOut/i));
  });

  it('handles linked status / personal / unknown command / unlink', async () => {
    getLinkedUserId.mockResolvedValue('usr_1');

    await signedPost(
      '/slack/commands',
      new URLSearchParams({ team_id: 'T1', user_id: 'U1', channel_id: 'D1', text: 'status', trigger_id: 't' }).toString(),
      'application/x-www-form-urlencoded',
    );
    expect(sendText).toHaveBeenCalledWith(expect.stringMatching(/Connected to ShareOut/i));

    await signedPost(
      '/slack/commands',
      new URLSearchParams({ team_id: 'T1', user_id: 'U1', channel_id: 'D1', text: 'personal', trigger_id: 't2' }).toString(),
      'application/x-www-form-urlencoded',
    );
    expect(setSelectedSlackWorkspace).toHaveBeenCalled();

    await signedPost(
      '/slack/commands',
      new URLSearchParams({ team_id: 'T1', user_id: 'U1', channel_id: 'D1', text: 'notacommand', trigger_id: 't3' }).toString(),
      'application/x-www-form-urlencoded',
    );
    expect(sendText).toHaveBeenCalledWith(expect.stringMatching(/don.?t know/i));

    await signedPost(
      '/slack/commands',
      new URLSearchParams({ team_id: 'T1', user_id: 'U1', channel_id: 'D1', text: 'unlink', trigger_id: 't4' }).toString(),
      'application/x-www-form-urlencoded',
    );
    expect(unlinkSlackDm).toHaveBeenCalledWith(ENV, 'T1', 'U1');
  });
});
