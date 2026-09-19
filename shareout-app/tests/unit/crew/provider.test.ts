// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/logging', async (orig) => {
  const actual = await orig<typeof import('../../../src/logging')>();
  return { ...actual, createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) };
});

import {
  AnthropicCrewProvider,
  FailoverCrewProvider,
  getCrewProvider,
  type CrewProvider,
  type ProviderEvent,
  type ProviderTurnArgs,
} from '../../../src/crew/provider';
import type { Env } from '../../../src/types';

afterEach(() => vi.restoreAllMocks());

function sse(events: unknown[]): Response {
  const body = events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(body));
      c.close();
    },
  }), { status: 200 });
}

async function collect(p: CrewProvider, args: ProviderTurnArgs): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const ev of p.streamTurn(args)) out.push(ev);
  return out;
}

const cfg = { provider: 'anthropic' as const, apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5' };
const env = {} as Env;

const args: ProviderTurnArgs = {
  system: 'sys',
  maxTokens: 500,
  tools: [{ name: 'list_artifacts', description: 'List', input_schema: { type: 'object', properties: {} } }],
  transcript: [
    { role: 'user', text: 'find my pages' },
    { role: 'assistant', text: '', toolCalls: [{ id: 'toolu_1', name: 'list_artifacts', input: { q: 'x' } }] },
    { role: 'tool', results: [{ id: 'toolu_1', content: '{"items":[]}' }] },
  ],
};

describe('AnthropicCrewProvider', () => {
  it('serializes the neutral transcript to the Messages API with tools', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([{ type: 'message_stop' }]));

    await collect(new AnthropicCrewProvider(cfg, env), args);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant');
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('sys');
    expect(body.tools).toEqual([{ name: 'list_artifacts', description: 'List', input_schema: { type: 'object', properties: {} } }]);
    expect(body.messages).toEqual([
      { role: 'user', content: 'find my pages' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'list_artifacts', input: { q: 'x' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"items":[]}' }] },
    ]);
  });

  it('streams text, assembles tool input from JSON deltas, and reports usage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([
      { type: 'message_start', message: { usage: { input_tokens: 12 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking.' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_9', name: 'query_connection', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"connection":"wa' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'rehouse"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ]));

    const events = await collect(new AnthropicCrewProvider(cfg, env), args);

    expect(events).toEqual([
      { type: 'text_delta', text: 'Checking.' },
      { type: 'tool_use', id: 'toolu_9', name: 'query_connection', input: { connection: 'warehouse' } },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 12, outputTokens: 20 } },
    ]);
  });

  it('marks a 529/5xx as retryable and a 400 as not', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('overloaded', { status: 529 }))
      .mockResolvedValueOnce(new Response('bad', { status: 400 }));
    const p = new AnthropicCrewProvider(cfg, env);

    expect(await collect(p, args)).toEqual([expect.objectContaining({ type: 'error', retryable: true })]);
    expect(await collect(p, args)).toEqual([expect.objectContaining({ type: 'error', retryable: false })]);
  });

  it('never echoes the provider response body to the user', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('secret internals sk-ant-xyz', { status: 500 }));
    const [ev] = await collect(new AnthropicCrewProvider(cfg, env), args);
    expect(ev.type === 'error' && ev.error).not.toMatch(/secret|sk-ant/);
  });
});

function scripted(name: string, events: ProviderEvent[]): CrewProvider & { calls: number } {
  return {
    provider: name,
    model: `${name}-model`,
    calls: 0,
    async *streamTurn() {
      this.calls++;
      for (const ev of events) yield ev;
    },
  };
}

const stop: ProviderEvent = { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };

describe('FailoverCrewProvider', () => {
  it('fails over on a retryable error before anything streamed', async () => {
    const a = scripted('a', [{ type: 'error', error: 'down', retryable: true }]);
    const b = scripted('b', [{ type: 'text_delta', text: 'hi' }, stop]);
    const p = new FailoverCrewProvider([a, b]);

    expect(await collect(p, args)).toEqual([{ type: 'text_delta', text: 'hi' }, stop]);
    expect(p.model).toBe('b-model');
  });

  it('does not fail over on a non-retryable error', async () => {
    const a = scripted('a', [{ type: 'error', error: 'bad request', retryable: false }]);
    const b = scripted('b', [stop]);

    expect(await collect(new FailoverCrewProvider([a, b]), args)).toEqual([{ type: 'error', error: 'bad request', retryable: false }]);
    expect(b.calls).toBe(0);
  });

  it('does not fail over once text has streamed', async () => {
    const a = scripted('a', [{ type: 'text_delta', text: 'par' }, { type: 'error', error: 'cut', retryable: true }]);
    const b = scripted('b', [stop]);

    const events = await collect(new FailoverCrewProvider([a, b]), args);
    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(b.calls).toBe(0);
  });

  it('surfaces the last provider error when every provider fails', async () => {
    const a = scripted('a', [{ type: 'error', error: 'a down', retryable: true }]);
    const b = scripted('b', [{ type: 'error', error: 'b down', retryable: true }]);

    expect(await collect(new FailoverCrewProvider([a, b]), args)).toEqual([{ type: 'error', error: 'b down', retryable: true }]);
  });
});

describe('getCrewProvider', () => {
  it('is null with no provider configured', () => {
    expect(getCrewProvider({} as Env)).toBeNull();
  });

  it('uses the native Anthropic provider when only ANTHROPIC_API_KEY is set', () => {
    const p = getCrewProvider({ ANTHROPIC_API_KEY: 'sk-ant' } as Env);
    expect(p).toBeInstanceOf(AnthropicCrewProvider);
    expect(p?.model).toBe('claude-sonnet-5');
  });

  it('chains every configured provider in AI_PROVIDER_ORDER', () => {
    const p = getCrewProvider({ ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk', AI_PROVIDER_ORDER: 'openai' } as Env);
    expect(p).toBeInstanceOf(FailoverCrewProvider);
    expect(p?.provider).toBe('openai');
  });
});
