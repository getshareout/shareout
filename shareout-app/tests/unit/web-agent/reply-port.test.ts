import { describe, expect, it } from 'vitest';
import { createWebReplyPort, agentMediaKey, type WebAgentEvent } from '../../../src/chat-platforms/web/reply-port';
import type { Env } from '../../../src/types';

function fakeEnv() {
  const puts: { key: string; mime?: string }[] = [];
  const env = {
    ARTIFACTS: {
      put: async (key: string, _bytes: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
        puts.push({ key, mime: opts?.httpMetadata?.contentType });
      },
    },
  } as unknown as Env;
  return { env, puts };
}

describe('createWebReplyPort', () => {
  it('emits text/typing/cards/confirm events', async () => {
    const { env } = fakeEnv();
    const events: WebAgentEvent[] = [];
    const port = createWebReplyPort(env, 'usr_1', (e) => events.push(e));

    await port.sendText('hello');
    await port.sendTyping();
    await port.sendArtifactCards([{ id: 'art_1', name: 'Dash', slug: 'dash' }]);
    await port.askConfirmation('Do it?', 'tok_1');

    expect(events).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'typing' },
      { type: 'cards', items: [{ id: 'art_1', name: 'Dash', slug: 'dash' }] },
      { type: 'confirm', prompt: 'Do it?', token: 'tok_1' },
    ]);
  });

  it('parks image bytes in R2 under a user-namespaced key and emits a media token', async () => {
    const { env, puts } = fakeEnv();
    const events: WebAgentEvent[] = [];
    const port = createWebReplyPort(env, 'usr_42', (e) => events.push(e));

    const ok = await port.sendImage(new ArrayBuffer(8), 'shot.png', 'A page');
    expect(ok).toBe(true);
    expect(puts).toHaveLength(1);
    const media = events.find((e) => e.type === 'media') as Extract<WebAgentEvent, { type: 'media' }>;
    expect(media.mime).toBe('image/png');
    expect(media.caption).toBe('A page');
    expect(puts[0].key).toBe(agentMediaKey('usr_42', media.token));
  });
});
