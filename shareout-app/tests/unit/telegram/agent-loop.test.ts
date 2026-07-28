import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';

const h = vi.hoisted(() => ({ script: [] as unknown[][], nullProvider: false }));

vi.mock('../../../src/crew/provider', () => ({
  getCrewProvider: () =>
    h.nullProvider
      ? null
      : {
          provider: 'mock',
          model: 'mock',
          async *streamTurn() {
            const turn = h.script.shift() ?? [];
            for (const ev of turn) yield ev;
          },
        },
}));

// The bot's feature gate is exercised separately; here treat it as enabled and
// avoid the workspace lookup so these turns run against an empty Env.
vi.mock('../../../src/chat-agent/access', () => ({
  getUserWorkspaceIds: vi.fn().mockResolvedValue([]),
  TELEGRAM_PERSONAL_WORKSPACE: '__personal',
}));
vi.mock('../../../src/features/flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));

import { runAgentTurn } from '../../../src/chat-agent/agent-loop';

const stop = (reason: string) => ({ type: 'message_stop', stopReason: reason, usage: { inputTokens: 1, outputTokens: 1 } });

beforeEach(() => {
  h.script = [];
  h.nullProvider = false;
});

const input = (userText: string) => ({ userId: 'u', chatId: 1, userText, history: [] });

describe('runAgentTurn', () => {
  it('returns the model text when no tools are called', async () => {
    h.script = [[{ type: 'text_delta', text: 'Hello there' }, stop('end_turn')]];
    const res = await runAgentTurn({} as Env, input('hi'));
    expect(res.reply).toBe('Hello there');
    expect(res.proposal).toBeUndefined();
  });

  it('runs a tool turn, then returns the final answer', async () => {
    h.script = [
      [{ type: 'tool_use', id: 't1', name: 'nope', input: {} }, stop('tool_use')],
      [{ type: 'text_delta', text: 'Done' }, stop('end_turn')],
    ];
    const res = await runAgentTurn({} as Env, input('do it'));
    expect(res.reply).toBe('Done');
  });

  it('surfaces a friendly message on provider error', async () => {
    h.script = [[{ type: 'error', error: 'boom' }]];
    const res = await runAgentTurn({} as Env, input('hi'));
    expect(res.reply).toMatch(/went wrong/i);
  });

  it('handles a missing provider gracefully', async () => {
    h.nullProvider = true;
    const res = await runAgentTurn({} as Env, input('hi'));
    expect(res.reply).toMatch(/can.t reach the AI/i);
  });
});
