import { describe, expect, it } from 'vitest';
import { verifySlackRequest, slackEventDedupId } from '../../../../src/chat-platforms/slack/verify';

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

describe('verifySlackRequest', () => {
  it('accepts a valid signature', async () => {
    const secret = 'test-signing-secret';
    const body = '{"type":"event_callback"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(secret, timestamp, body);
    const request = new Request('https://shareout.site/slack/events', {
      method: 'POST',
      headers: {
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': signature,
      },
      body,
    });
    expect(await verifySlackRequest(request, secret, body)).toBe(true);
  });

  it('rejects a bad signature', async () => {
    const body = '{}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const request = new Request('https://shareout.site/slack/events', {
      method: 'POST',
      headers: {
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': 'v0=deadbeef',
      },
      body,
    });
    expect(await verifySlackRequest(request, 'secret', body)).toBe(false);
  });
});

describe('slackEventDedupId', () => {
  it('returns a stable positive integer', () => {
    expect(slackEventDedupId('Ev123')).toBe(slackEventDedupId('Ev123'));
    expect(slackEventDedupId('Ev123')).toBeGreaterThan(0);
  });
});
