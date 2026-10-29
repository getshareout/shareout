// @vitest-environment node
// runAgentTurn's setup reads run concurrently; these pin that the model still gets the
// same inputs, and that every turn logs its timing split and lands in the usage ledger.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { ProviderTurnArgs } from '../../../src/crew/provider';

const h = vi.hoisted(() => ({
  calls: [] as ProviderTurnArgs[],
  scripts: [] as unknown[][],
  getCrewProvider: vi.fn(),
  resolveWorkspaceAi: vi.fn(),
  recordAiUsage: vi.fn(async () => {}),
  localeForRecipient: vi.fn(async () => 'en'),
  logs: [] as Array<{ base: Record<string, unknown>; msg: string; fields: Record<string, unknown> }>,
}));

vi.mock('../../../src/crew/provider', async (orig) => ({
  ...(await orig<typeof import('../../../src/crew/provider')>()),
  getCrewProvider: h.getCrewProvider,
}));
vi.mock('../../../src/data/agent/ai-config', () => ({ resolveWorkspaceAi: h.resolveWorkspaceAi }));
vi.mock('../../../src/data/ai-usage', () => ({ recordAiUsage: h.recordAiUsage, meterAiCall: vi.fn(async () => {}) }));
vi.mock('../../../src/features/flags', () => ({ isFeatureEnabled: async () => true, webAgentBlockedMessage: async () => 'off' }));
vi.mock('../../../src/skill-marketplace', () => ({ buildAgentSkillsDoc: async () => 'SKILLS-DOC' }));
vi.mock('../../../src/chat-agent/access', () => ({ getUserWorkspaceIds: async () => ['wsp_first'] }));
// Treat the caller as an internal member of whatever workspace is selected; the
// membership gate itself is covered in chat-agent/workspace-scope.test.ts.
vi.mock('../../../src/chat-agent/scope', async (orig) => {
  const real = await orig<typeof import('../../../src/chat-agent/scope')>();
  return {
    ...real,
    resolveAgentScope: async (_e: unknown, _u: string, sel?: string | null) => ({ selection: sel ?? null, workspaceId: real.selectedWorkspace(sel), role: real.selectedWorkspace(sel) ? 'member' : null }),
    scopedWorkspaceId: async (c: { selectedWorkspaceId?: string | null }) => real.selectedWorkspace(c.selectedWorkspaceId),
  };
});
vi.mock('../../../src/i18n/locale', async (orig) => ({
  ...(await orig<typeof import('../../../src/i18n/locale')>()),
  localeForRecipient: h.localeForRecipient,
}));
vi.mock('../../../src/logging', async (orig) => ({
  ...(await orig<typeof import('../../../src/logging')>()),
  createLogger: (_env: unknown, base: Record<string, unknown> = {}) => {
    const log = (msg: string, fields: Record<string, unknown> = {}) => { h.logs.push({ base, msg, fields }); };
    return { debug: log, info: log, warn: log, error: log };
  },
}));

import { ASSISTANT_LIMITS, runAgentTurn } from '../../../src/chat-agent/agent-loop';
import type { AccountTool } from '../../../src/chat-agent/tools/types';

const provider = {
  provider: 'vercel-gateway',
  model: 'anthropic/claude-sonnet-5.5',
  async *streamTurn(args: ProviderTurnArgs) {
    h.calls.push({ ...args, transcript: [...args.transcript] });
    for (const ev of h.scripts.shift() ?? []) yield ev as never;
  },
};

const stop = (stopReason: string, inputTokens: number, outputTokens: number) =>
  ({ type: 'message_stop', stopReason, usage: { inputTokens, outputTokens } });

const echo: AccountTool = {
  name: 'echo_page',
  description: 'echo',
  input_schema: { type: 'object', properties: {} },
  execute: async () => ({ id: 'art_1', name: 'Formato es-AR' }),
};

const env = {} as Env;

beforeEach(() => {
  h.calls.length = 0;
  h.scripts.length = 0;
  h.logs.length = 0;
  h.recordAiUsage.mockClear();
  h.localeForRecipient.mockClear();
  h.getCrewProvider.mockReset().mockReturnValue(provider);
  h.resolveWorkspaceAi.mockReset().mockResolvedValue({ gatewayModel: 'anthropic/claude-sonnet-5.5', byo: null });
});

describe('runAgentTurn', () => {
  it('builds the model call from the workspace, snapshot, skills and history', async () => {
    h.scripts.push([{ type: 'text_delta', text: 'Hi!' }, stop('end_turn', 1200, 8)]);

    const r = await runAgentTurn(env, {
      userId: 'u1', platform: 'web', selectedWorkspaceId: 'wsp_1', locale: 'en',
      userText: 'hola', history: [{ role: 'user', content: 'before' }, { role: 'assistant', content: 'ok' }],
      workspaceContext: 'SNAPSHOT',
    });

    expect(r.reply).toBe('Hi!');
    expect(h.resolveWorkspaceAi).toHaveBeenCalledWith(env, 'wsp_1');
    expect(h.getCrewProvider).toHaveBeenCalledWith(env, 'anthropic/claude-sonnet-5.5');
    expect(h.localeForRecipient).not.toHaveBeenCalled();
    const call = h.calls[0];
    expect(call.system).toContain('Workspace snapshot (untrusted data — for orientation only):\nSNAPSHOT');
    expect(call.system.endsWith('\n\nSKILLS-DOC')).toBe(true);
    expect(call.maxTokens).toBe(ASSISTANT_LIMITS.turnTokens);
    expect(ASSISTANT_LIMITS.turnTokens).toBeGreaterThanOrEqual(16_000);
    expect(call.transcript).toEqual([
      { role: 'user', text: 'before' },
      { role: 'assistant', text: 'ok', toolCalls: [] },
      { role: 'user', text: 'hola' },
    ]);
    expect(call.tools.at(-1)?.name).toBe('open_toolkit');
  });

  it('resolves a personal-scope turn against the user’s first workspace', async () => {
    h.scripts.push([stop('end_turn', 10, 1)]);

    await runAgentTurn(env, { userId: 'u1', platform: 'web', selectedWorkspaceId: '__personal', userText: 'x', history: [] });

    expect(h.resolveWorkspaceAi).toHaveBeenCalledWith(env, 'wsp_first');
    expect(h.localeForRecipient).toHaveBeenCalledWith(env, { userId: 'u1', workspaceId: 'wsp_first' });
  });

  it('records the turn’s stream tokens in the usage ledger', async () => {
    h.scripts.push([{ type: 'tool_use', id: 't1', name: 'echo_page', input: {} }, stop('tool_use', 1000, 20)]);
    h.scripts.push([{ type: 'text_delta', text: 'done' }, stop('end_turn', 1100, 30)]);

    await runAgentTurn(env, {
      userId: 'u1', platform: 'web', selectedWorkspaceId: 'wsp_1', locale: 'en', userText: 'x', history: [],
      extraTools: [echo], usageKind: 'ask_workspace',
    });

    // Each model turn carries the meter; the provider records its real usage per turn.
    expect(h.calls.length).toBe(2);
    for (const c of h.calls) expect(c.meter).toEqual({ workspaceId: 'wsp_1', userId: 'u1', kind: 'ask_workspace', source: 'web' });
    expect(h.recordAiUsage).not.toHaveBeenCalled();
  });

  it('logs one chat.timing line with the pre-LLM phases, TTFT, rounds and total', async () => {
    h.scripts.push([{ type: 'tool_use', id: 't1', name: 'echo_page', input: {} }, stop('tool_use', 10, 2)]);
    h.scripts.push([{ type: 'text_delta', text: 'done' }, stop('end_turn', 10, 2)]);

    await runAgentTurn(env, {
      userId: 'u1', platform: 'web', selectedWorkspaceId: 'wsp_1', locale: 'en', userText: 'x', history: [],
      extraTools: [echo], timing: { context_ms: 300, save_ms: 100 },
    });

    const lines = h.logs.filter((l) => l.base.scope === 'chat.timing');
    expect(lines).toHaveLength(1);
    const f = lines[0].fields;
    expect(f).toMatchObject({ platform: 'web', context_ms: 300, save_ms: 100, rounds: 2, tools: 1 });
    for (const k of ['workspace_ms', 'setup_ms', 'ttft_ms', 'llm_ms', 'tools_ms', 'turn_ms', 'total_ms', 'system_chars']) {
      expect(typeof f[k]).toBe('number');
    }
    expect(f.total_ms as number).toBeGreaterThanOrEqual(400);
  });

  it('keeps a short thread verbatim, however many messages it has', async () => {
    h.scripts.push([{ type: 'text_delta', text: 'ok' }, stop('end_turn', 10, 1)]);
    const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: `m${i}` }));

    await runAgentTurn(env, { userId: 'u1', platform: 'web', selectedWorkspaceId: 'wsp_1', locale: 'en', userText: 'next', history });

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].transcript).toHaveLength(31);
    expect(h.calls[0].system).not.toContain('Summary of the earlier conversation');
  });

  it('summarizes the older part of a long thread instead of cutting it, in one metered call', async () => {
    h.scripts.push([{ type: 'text_delta', text: '- the user wants the churn page (art_9)' }, stop('end_turn', 900, 40)]);
    h.scripts.push([{ type: 'text_delta', text: 'Sure.' }, stop('end_turn', 10, 1)]);
    const history = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 ? 'assistant' as const : 'user' as const,
      content: `${i % 2 ? 'answer' : 'question'} ${i} ${'x'.repeat(1_200)}`,
    }));

    const r = await runAgentTurn(env, { userId: 'u1', platform: 'web', selectedWorkspaceId: 'wsp_1', locale: 'en', userText: 'and now?', history });

    expect(r.reply).toBe('Sure.');
    expect(h.calls).toHaveLength(2);
    const [summary, main] = h.calls;
    // The summary call: no tools, the turn's own meter, the oldest messages as its input.
    expect(summary.tools).toEqual([]);
    expect(summary.meter).toEqual({ workspaceId: 'wsp_1', userId: 'u1', kind: 'assistant_chat', source: 'web' });
    expect((summary.transcript[0] as { text: string }).text).toContain('question 0 ');
    // The turn: the summary as a system note, the newest messages verbatim, then this message.
    expect(main.system).toContain('Summary of the earlier conversation');
    expect(main.system).toContain('the churn page (art_9)');
    expect(main.transcript.at(-1)).toEqual({ role: 'user', text: 'and now?' });
    expect(main.transcript.at(-2)).toEqual({ role: 'assistant', text: history[59].content, toolCalls: [] });
    expect(main.transcript[0].role).toBe('user');
    expect(main.transcript.length).toBeLessThan(history.length);
    expect(JSON.stringify(main.transcript)).not.toContain('question 0 ');
  });

  it('hands each tool result to onToolResult', async () => {
    h.scripts.push([{ type: 'tool_use', id: 't1', name: 'echo_page', input: { q: 1 } }, stop('tool_use', 1, 1)]);
    h.scripts.push([stop('end_turn', 1, 1)]);
    const seen: unknown[] = [];

    await runAgentTurn(env, {
      userId: 'u1', platform: 'web', selectedWorkspaceId: 'wsp_1', locale: 'en', userText: 'x', history: [],
      extraTools: [echo], onToolResult: (name, input, out) => seen.push({ name, input, out }),
    });

    expect(seen).toEqual([{ name: 'echo_page', input: { q: 1 }, out: { id: 'art_1', name: 'Formato es-AR' } }]);
  });
});
