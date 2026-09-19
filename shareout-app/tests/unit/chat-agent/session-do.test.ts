import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const h = vi.hoisted(() => ({
  runAgentTurn: vi.fn(),
  executeAction: vi.fn(),
  allowed: true,
  port: {
    sendText: vi.fn(async () => {}),
    sendTyping: vi.fn(async () => {}),
    sendImage: vi.fn(async () => true),
    sendFile: vi.fn(async () => true),
    sendArtifactCards: vi.fn(async () => {}),
    askConfirmation: vi.fn(async () => 777),
    answerCallback: vi.fn(async () => {}),
    editConfirmation: vi.fn(async () => {}),
  },
}));

vi.mock('../../../src/chat-agent/agent-loop', () => ({ runAgentTurn: h.runAgentTurn }));
vi.mock('../../../src/chat-agent/actions', () => ({
  executeAction: h.executeAction,
  describeAction: (a: { type: string }) => `Do ${a.type}?`,
}));
vi.mock('../../../src/chat-platforms/telegram/reply-port', () => ({ createTelegramReplyPort: () => h.port }));
vi.mock('../../../src/rate-limit', () => ({ checkAiChatLimit: async () => ({ allowed: h.allowed }) }));

import { ChatSessionDO } from '../../../src/chat-agent/session-do';

const testEnv = env as unknown as Env;

beforeEach(() => {
  h.runAgentTurn.mockReset();
  h.executeAction.mockReset();
  h.allowed = true;
  for (const fn of Object.values(h.port)) fn.mockClear();
});

/** A ChatSessionDO over real DO SQLite storage, with the agent/platform edges mocked. */
async function withSession<R>(fn: (send: (body: object) => Promise<Response>) => Promise<R>): Promise<R> {
  const stub = testEnv.CHAT.get(testEnv.CHAT.newUniqueId());
  return runInDurableObject(stub, async (_instance, state) => {
    const session = new ChatSessionDO(state, {} as Env);
    const send = (body: object) =>
      session.fetch(new Request('https://do/turn', { method: 'POST', body: JSON.stringify(body) }));
    return fn(send);
  });
}

const turn = (updateId: number, text: string) => ({
  platform: 'telegram', sessionKey: 'tg:1', userId: 'u1', text, updateId, nativeChatId: 1,
});

const callback = (updateId: number, data: string) => ({
  type: 'callback', platform: 'telegram', sessionKey: 'tg:1', userId: 'u1', data,
  callbackId: `cb${updateId}`, messageId: 5, updateId, nativeChatId: 1,
});

describe('ChatSessionDO', () => {
  it('rejects a non-JSON body', async () => {
    const stub = testEnv.CHAT.get(testEnv.CHAT.newUniqueId());
    const res = await runInDurableObject(stub, (_i, state) =>
      new ChatSessionDO(state, {} as Env).fetch(new Request('https://do/turn', { method: 'POST', body: 'nope' })),
    );
    expect(res.status).toBe(400);
  });

  it('runs a turn once per update_id (webhook retries are no-ops)', async () => {
    h.runAgentTurn.mockResolvedValue({ reply: 'hi back' });
    await withSession(async (send) => {
      await send(turn(1, 'hi'));
      await send(turn(1, 'hi'));
    });
    expect(h.runAgentTurn).toHaveBeenCalledTimes(1);
    expect(h.port.sendText).toHaveBeenCalledTimes(1);
    expect(h.port.sendText).toHaveBeenCalledWith('hi back');
  });

  it('serializes concurrent turns and feeds each the prior history', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const order: string[] = [];
    h.runAgentTurn.mockImplementation(async (_env, input: { userText: string; history: unknown[] }) => {
      order.push(`start:${input.userText}`);
      if (input.userText === 'first') await gate;
      order.push(`end:${input.userText}`);
      return { reply: `re:${input.userText}` };
    });

    await withSession(async (send) => {
      const a = send(turn(10, 'first'));
      const b = send(turn(11, 'second'));
      await new Promise((r) => setTimeout(r, 10));
      expect(order).toEqual(['start:first']);
      release();
      await Promise.all([a, b]);
    });

    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    expect(h.runAgentTurn.mock.calls[1][1].history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 're:first' },
    ]);
  });

  it('asks for confirmation, runs the action on OK, and expires the token after use', async () => {
    const action = { type: 'share_artifact', artifactId: 'a1' };
    h.runAgentTurn.mockResolvedValue({ reply: 'Sharing', proposal: action });
    h.executeAction.mockResolvedValue('Shared ✅');

    await withSession(async (send) => {
      await send(turn(20, 'share it'));
      expect(h.port.askConfirmation).toHaveBeenCalledWith('Do share_artifact?', expect.stringMatching(/^pa/));
      const token = h.port.askConfirmation.mock.calls[0][1] as string;

      await send(callback(21, `ok:${token}`));
      expect(h.executeAction).toHaveBeenCalledWith({}, 'u1', action);
      expect(h.port.editConfirmation).toHaveBeenCalledWith('777', '✅ Confirmed.');
      expect(h.port.sendText).toHaveBeenLastCalledWith('Shared ✅');

      await send(callback(22, `ok:${token}`));
      expect(h.executeAction).toHaveBeenCalledTimes(1);
      expect(h.port.answerCallback).toHaveBeenLastCalledWith('cb22', 'That request expired.');
    });
  });

  it('cancels without running the action', async () => {
    h.runAgentTurn.mockResolvedValue({ reply: '', proposal: { type: 'manage_job' } });
    await withSession(async (send) => {
      await send(turn(30, 'pause the job'));
      const token = h.port.askConfirmation.mock.calls[0][1] as string;
      await send(callback(31, `no:${token}`));
    });
    expect(h.executeAction).not.toHaveBeenCalled();
    expect(h.port.editConfirmation).toHaveBeenCalledWith('777', '❌ Cancelled.');
  });

  it('acks a duplicate callback delivery without re-running the action', async () => {
    h.runAgentTurn.mockResolvedValue({ reply: '', proposal: { type: 'share_artifact' } });
    h.executeAction.mockResolvedValue('done');
    await withSession(async (send) => {
      await send(turn(40, 'share'));
      const token = h.port.askConfirmation.mock.calls[0][1] as string;
      await send(callback(41, `ok:${token}`));
      await send(callback(41, `ok:${token}`));
    });
    expect(h.executeAction).toHaveBeenCalledTimes(1);
    expect(h.port.answerCallback).toHaveBeenLastCalledWith('cb41');
  });

  it('throttles without calling the model when rate limited', async () => {
    h.allowed = false;
    await withSession(async (send) => send(turn(50, 'spam')));
    expect(h.runAgentTurn).not.toHaveBeenCalled();
    expect(h.port.sendText).toHaveBeenCalledWith(expect.stringMatching(/bit fast/));
  });

  it('replies with a friendly message when the turn crashes, and keeps serving', async () => {
    h.runAgentTurn.mockRejectedValueOnce(new Error('D1 exploded')).mockResolvedValueOnce({ reply: 'ok now' });
    await withSession(async (send) => {
      await send(turn(60, 'one'));
      await send(turn(61, 'two'));
    });
    expect(h.port.sendText).toHaveBeenNthCalledWith(1, expect.stringMatching(/went wrong/));
    expect(h.port.sendText).toHaveBeenNthCalledWith(2, 'ok now');
    expect(JSON.stringify(h.port.sendText.mock.calls)).not.toContain('D1 exploded');
  });
});
