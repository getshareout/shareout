import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';

const h = vi.hoisted(() => ({
  script: [] as unknown[][],
  nullProvider: false,
  transcripts: [] as unknown[],
  admin: false,
  logError: vi.fn(),
}));

vi.mock('../../../src/crew/provider', () => ({
  getCrewProvider: () =>
    h.nullProvider
      ? null
      : {
          provider: 'mock',
          model: 'mock',
          async *streamTurn(args: { transcript: unknown[] }) {
            h.transcripts.push(JSON.parse(JSON.stringify(args.transcript)));
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
vi.mock('../../../src/superadmin/auth', () => ({
  isPlatformAdmin: vi.fn(async () => h.admin),
}));
vi.mock('../../../src/data/agent/ai-config', () => ({
  resolveGatewayModel: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../src/logging', async (orig) => {
  const actual = await orig<typeof import('../../../src/logging')>();
  return { ...actual, createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: h.logError }) };
});

import { runAgentTurn, NO_PROVIDER_ADMIN_REPLY, NO_PROVIDER_MEMBER_REPLY } from '../../../src/chat-agent/agent-loop';
import type { AccountTool } from '../../../src/chat-agent/tools/index';
import type { ChatReplyPort } from '../../../src/chat-platforms/types';

const stop = (reason: string) => ({ type: 'message_stop', stopReason: reason, usage: { inputTokens: 1, outputTokens: 1 } });

beforeEach(() => {
  h.script = [];
  h.nullProvider = false;
  h.transcripts = [];
  h.admin = false;
  h.logError.mockReset();
});

function throwingTool(err: Error): AccountTool {
  return {
    name: 'boom_tool',
    description: 'throws',
    input_schema: { type: 'object', properties: {} },
    execute: async () => { throw err; },
  } as unknown as AccountTool;
}

function port(overrides: Partial<ChatReplyPort> = {}): ChatReplyPort {
  return {
    sendText: vi.fn(async () => {}),
    sendTyping: vi.fn(async () => {}),
    sendImage: vi.fn(async () => true),
    sendFile: vi.fn(async () => true),
    sendArtifactCards: vi.fn(async () => {}),
    askConfirmation: vi.fn(async () => undefined),
    ...overrides,
  };
}

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

  it('tells a member that an admin needs to connect a provider', async () => {
    h.nullProvider = true;
    const res = await runAgentTurn({} as Env, input('hi'));
    expect(res.reply).toBe(NO_PROVIDER_MEMBER_REPLY);
  });

  it('tells an instance admin exactly which secret to set', async () => {
    h.nullProvider = true;
    h.admin = true;
    const res = await runAgentTurn({} as Env, input('hi'));
    expect(res.reply).toBe(NO_PROVIDER_ADMIN_REPLY);
    expect(res.reply).toContain('ANTHROPIC_API_KEY');
  });

  it('gives the model a sanitized tool error and logs the real one', async () => {
    h.script = [
      [{ type: 'tool_use', id: 't1', name: 'boom_tool', input: {} }, stop('tool_use')],
      [{ type: 'text_delta', text: 'Sorry' }, stop('end_turn')],
    ];
    const res = await runAgentTurn({} as Env, {
      ...input('go'),
      extraTools: [throwingTool(new Error('D1_ERROR: no such column: secret_col'))],
    });

    expect(res.reply).toBe('Sorry');
    const toolTurn = (h.transcripts[1] as Array<{ role: string; results?: Array<{ content: string }> }>).at(-1);
    expect(toolTurn?.results?.[0].content).toBe(JSON.stringify({ error: 'Tool failed.' }));
    expect(h.logError).toHaveBeenCalledWith(
      'chat agent tool failed',
      expect.objectContaining({ error_message: 'D1_ERROR: no such column: secret_col' }),
    );
  });

  it('announces a running tool on web and refreshes typing on bots', async () => {
    const script = () => [
      [{ type: 'tool_use', id: 't1', name: 'query_connection', input: { connection: 'Warehouse' } }, stop('tool_use')],
      [{ type: 'text_delta', text: 'Done' }, stop('end_turn')],
    ];

    h.script = script();
    const web = port({ sendToolProgress: vi.fn(async () => {}) });
    await runAgentTurn({} as Env, { ...input('q'), platform: 'web', reply: web });
    expect(web.sendToolProgress).toHaveBeenCalledWith('Querying Warehouse…');

    h.script = script();
    const bot = port();
    await runAgentTurn({} as Env, { ...input('q'), reply: bot });
    expect(bot.sendTyping).toHaveBeenCalled();
  });

  it('keeps going when the progress channel fails', async () => {
    h.script = [
      [{ type: 'tool_use', id: 't1', name: 'nope', input: {} }, stop('tool_use')],
      [{ type: 'text_delta', text: 'Done' }, stop('end_turn')],
    ];
    const res = await runAgentTurn({} as Env, {
      ...input('q'),
      reply: port({ sendToolProgress: vi.fn(async () => { throw new Error('closed'); }) }),
      extraTools: [{ ...throwingTool(new Error('x')), name: 'nope', execute: async () => ({ ok: true }) } as unknown as AccountTool],
    });
    expect(res.reply).toBe('Done');
  });
});
