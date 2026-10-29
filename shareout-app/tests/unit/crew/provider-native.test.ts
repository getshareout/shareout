// @vitest-environment node
// Truncation surfaced as max_tokens on every route, and the Anthropic-native harness features
// (compaction, context editing, task budget) sent only on the direct Anthropic route.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/logging', async (orig) => {
  const actual = await orig<typeof import('../../../src/logging')>();
  return { ...actual, createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) };
});

import { AnthropicCrewProvider, OpenAICompatCrewProvider, type ProviderEvent, type ProviderTurnArgs } from '../../../src/crew/provider';
import type { Env } from '../../../src/types';

afterEach(() => vi.restoreAllMocks());

const sse = (events: unknown[]) => new Response(new ReadableStream({
  start(c) {
    c.enqueue(new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')));
    c.close();
  },
}), { status: 200 });

const collect = async (gen: AsyncGenerator<ProviderEvent>) => {
  const out: ProviderEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};

const env = {} as Env;
const anthropic = { provider: 'anthropic' as const, apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' };
const gateway = { provider: 'vercel-gateway' as const, apiKey: 'vk', baseUrl: 'https://ai-gateway.example/v1', model: 'anthropic/claude-sonnet-5.5' };

const args: ProviderTurnArgs = {
  meter: { workspaceId: null, userId: null, kind: 'page_build', source: null },
  system: 'sys',
  maxTokens: 1000,
  tools: [{ name: 'write_file', description: 'w', input_schema: { type: 'object', properties: {} }, eagerInput: true }],
  transcript: [{ role: 'user', text: 'go' }],
};
const native = { compactAtTokens: 100_000, clearToolUses: { triggerTokens: 60_000, keep: 8, clearInputs: true }, taskBudgetTokens: 120_000 };

describe('truncation is surfaced', () => {
  it('Anthropic: stop_reason max_tokens, with a half-written tool call marked invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([
      { type: 'message_start', message: { usage: { input_tokens: 5 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'write_file', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a.js","content":"abc' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 1000 } },
    ]));
    const events = await collect(new AnthropicCrewProvider(anthropic, env).streamTurn(args));
    expect(events[0]).toMatchObject({ type: 'tool_use', input: { __invalid_json: expect.any(String) } });
    expect(events.at(-1)).toMatchObject({ type: 'message_stop', stopReason: 'max_tokens' });
  });

  it('OpenAI-compatible: finish_reason length', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path":"a' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 5, completion_tokens: 1000 } },
    ]));
    const events = await collect(new OpenAICompatCrewProvider(gateway, env).streamTurn(args));
    expect(events.at(-1)).toMatchObject({ type: 'message_stop', stopReason: 'max_tokens' });
  });

  it('a normal stop is still end_turn / tool_use', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([{ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }]));
    expect((await collect(new OpenAICompatCrewProvider(gateway, env).streamTurn(args))).at(-1)).toMatchObject({ stopReason: 'end_turn' });
  });
});

describe('Anthropic-native harness (direct route only)', () => {
  it('sends the beta headers, compaction, context editing and task budget', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }]));
    await collect(new AnthropicCrewProvider(anthropic, env).streamTurn({ ...args, native }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['anthropic-beta'].split(',').sort()).toEqual(['compact-2026-01-12', 'context-management-2025-06-27', 'task-budgets-2026-03-13']);
    const body = JSON.parse(init.body as string);
    expect(body.context_management.edits).toEqual([
      { type: 'clear_tool_uses_20250919', trigger: { type: 'input_tokens', value: 60_000 }, keep: { type: 'tool_uses', value: 8 }, clear_tool_inputs: true },
      { type: 'compact_20260112', trigger: { type: 'input_tokens', value: 100_000 } },
    ]);
    expect(body.output_config).toEqual({ task_budget: { type: 'tokens', total: 120_000 } });
    expect(body.tools[0].eager_input_streaming).toBe(true);
  });

  it('sends none of it without native options', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([]));
    await collect(new AnthropicCrewProvider(anthropic, env).streamTurn(args));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['anthropic-beta']).toBeUndefined();
    expect(JSON.parse(init.body as string).context_management).toBeUndefined();
  });

  it('the gateway and OpenAI routes ignore it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([]));
    await collect(new OpenAICompatCrewProvider(gateway, env).streamTurn({ ...args, native }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(Object.keys(init.headers as object).some((h) => h.toLowerCase().includes('beta'))).toBe(false);
    const body = JSON.parse(init.body as string);
    expect(body.context_management).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(JSON.stringify(body.tools)).not.toContain('eager_input_streaming');
  });

  it('keeps a compaction summary and sends it back verbatim ahead of the assistant text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(sse([
      { type: 'content_block_start', index: 0, content_block: { type: 'compaction' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'compaction_delta', content: 'Summary: page has 3 files' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3, iterations: [{ type: 'compaction', input_tokens: 100, output_tokens: 40 }, { type: 'message', input_tokens: 5, output_tokens: 3 }] } },
    ]));
    const events = await collect(new AnthropicCrewProvider(anthropic, env).streamTurn({ ...args, native }));
    expect(events).toContainEqual({ type: 'compaction', content: 'Summary: page has 3 files' });
    // The compaction run is billed separately: the meter sees it.
    expect(events.at(-1)).toMatchObject({ usage: { outputTokens: 43 } });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([]));
    await collect(new AnthropicCrewProvider(anthropic, env).streamTurn({
      ...args,
      transcript: [...args.transcript, { role: 'assistant', text: 'continuing', toolCalls: [], compaction: 'Summary: page has 3 files' }, { role: 'user', text: 'next' }],
    }));
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(body.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'compaction', content: 'Summary: page has 3 files' }, { type: 'text', text: 'continuing' }] });
  });

  it('retries once without the beta features when the API refuses them, and stops asking', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('unsupported', { status: 400 }))
      .mockResolvedValue(sse([{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }]));
    const p = new AnthropicCrewProvider(anthropic, env);
    const first = await collect(p.streamTurn({ ...args, native }));
    expect(first.some((e) => e.type === 'error')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).not.toHaveProperty('anthropic-beta');
    await collect(p.streamTurn({ ...args, native }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).not.toHaveProperty('anthropic-beta');
  });
});
